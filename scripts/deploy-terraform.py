"""Cria um ambiente regional completo. Credenciais vêm da cadeia padrão da AWS.

Requer Terraform, AWS CLI e Docker/buildx. Não executa destroy. A inferência
usa Bedrock com IAM Role, sem chave OpenAI.
Valores de segredos são tratados em memória e enviados diretamente pelo SDK.
"""
import argparse
import base64
import datetime
import json
import os
import re
import secrets
import shutil
import subprocess
import tempfile
import time
from pathlib import Path
from urllib.parse import quote
try:
    import botocore.session
except ModuleNotFoundError:
    import awscli  # Algumas distribuições do CLI disponibilizam o SDK ao importar.
    import botocore.session
from botocore.config import Config
from botocore.exceptions import ClientError

parser = argparse.ArgumentParser()
parser.add_argument('--region', default='sa-east-1')
parser.add_argument('--name', default='periferia-sp')
parser.add_argument('--terraform', default=shutil.which('terraform'))
parser.add_argument('--aws', default=shutil.which('aws'))
parser.add_argument('--docker', default=shutil.which('docker'))
parser.add_argument('--work-dir', type=Path)
parser.add_argument('--bedrock-model-id', default='global.openai.gpt-6-luna')
parser.add_argument('--skip-build', action='store_true', help='Reutilizar o digest regional já publicado por uma execução anterior.')
args = parser.parse_args()
if not all([args.terraform, args.aws, args.docker]):
    parser.error('Terraform, AWS CLI e Docker são necessários.')
root = Path(__file__).resolve().parents[1]
infra = root / 'infra/terraform'
work = args.work_dir.resolve() if args.work_dir else Path(tempfile.mkdtemp(prefix=args.name + '-deploy-'))
work.mkdir(parents=True, exist_ok=True, mode=0o700)
env = os.environ.copy()
env.update(AWS_DEFAULT_REGION=args.region, AWS_PAGER='', TF_IN_AUTOMATION='1', CHECKPOINT_DISABLE='1')
plugin_info = subprocess.run([args.docker, 'info', '--format', '{{json .ClientInfo.Plugins}}'], env=env, capture_output=True, text=True, check=True)
buildx_plugin = next((p['Path'] for p in json.loads(plugin_info.stdout) if p['Name'] == 'buildx'), None)
if not buildx_plugin:
    raise RuntimeError('Docker buildx não está instalado no contexto atual.')
env['DOCKER_CONFIG'] = str(work / 'docker')
Path(env['DOCKER_CONFIG']).mkdir(exist_ok=True, mode=0o700)
plugin_dir = Path(env['DOCKER_CONFIG']) / 'cli-plugins'
plugin_dir.mkdir(exist_ok=True)
plugin_link = plugin_dir / 'docker-buildx'
if not plugin_link.exists():
    plugin_link.symlink_to(Path(buildx_plugin).resolve())
events = []
aws_session = botocore.session.get_session()
clients = {}
def stage(name):
    row = {'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'stage': name}
    events.append(row)
    (work / 'progress.json').write_text(json.dumps(events, indent=2))
    print(json.dumps(row), flush=True)
class AwsFailure(RuntimeError):
    def __init__(self, service, operation, code):
        self.code = code
        super().__init__(f'AWS {service}:{operation} falhou ({code}); conferir configuração/permissões sem registrar segredos.')
def aws(service, operation, params=None, region=None, extra=()):
    # O SDK mantém SecretString em memória; nenhum segredo vai para argv,
    # arquivo temporário, plano ou log. AWS CLI fica apenas no waiter final.
    params = dict(params or {})
    if service == 's3api' and operation == 'put-object':
        if len(extra) != 2 or extra[0] != '--body':
            raise ValueError('Upload de estado exige arquivo explícito.')
        params['Body'] = Path(extra[1]).read_bytes()
    client_key = ('s3' if service == 's3api' else service, region or args.region)
    if client_key not in clients:
        clients[client_key] = aws_session.create_client(client_key[0], region_name=client_key[1], config=Config(connect_timeout=10, read_timeout=60, retries={'mode': 'standard', 'max_attempts': 3}))
    values = params
    try:
        result = getattr(clients[client_key], operation.replace('-', '_'))(**values)
    except ClientError as error:
        raise AwsFailure(service, operation, error.response['Error']['Code']) from None
    if service == 's3api' and operation == 'get-object':
        Path(extra[0]).write_bytes(result['Body'].read())
    return result
def tf(directory, *arguments, capture=False):
    scope = 'state' if directory.name == 'state' else 'app'
    task_env = env | {'TF_DATA_DIR': str(work / ('terraform-' + scope))}
    command = [args.terraform, '-chdir=' + str(directory), *arguments, '-no-color']
    if capture:
        result = subprocess.run(command, env=task_env, capture_output=True, text=True, check=True)
        return result.stdout
    with (work / ('terraform-' + scope + '.log')).open('a') as log:
        subprocess.run(command, env=task_env, stdout=log, stderr=subprocess.STDOUT, check=True)
def apply(directory, extra=()):
    tf(directory, 'validate')
    plan = work / ('state.tfplan' if directory.name == 'state' else 'app.tfplan')
    variables_arg = [] if directory.name == 'state' else ['-var-file=' + str(work / 'deployment.tfvars.json')]
    tf(directory, 'plan', '-input=false', '-out=' + str(plan), *variables_arg, *extra)
    tf(directory, 'apply', '-input=false', *[value for value in extra if value.startswith('-state=')], str(plan))
def read_secret(arn, region=None):
    return aws('secretsmanager', 'get-secret-value', {'SecretId': arn}, region).get('SecretString')
def existing_secret(arn):
    try:
        return read_secret(arn)
    except RuntimeError:
        # Distinguir segredo vazio de erro de acesso sem presumir que se pode sobrescrever.
        metadata = aws('secretsmanager', 'describe-secret', {'SecretId': arn})
        if metadata.get('VersionIdsToStages'):
            raise
        return None
def put_secret(arn, value):
    aws('secretsmanager', 'put-secret-value', {'SecretId': arn, 'SecretString': value})
def outputs(allow_empty=False):
    values = json.loads(tf(infra, 'output', '-json', capture=True))
    if 'deployment' not in values:
        if allow_empty:
            return None
        raise RuntimeError('A aplicação Terraform ainda não produziu o output deployment.')
    return values['deployment']['value']

stage('bootstrap do estado remoto')
tf(infra / 'state', 'init', '-input=false')
state_path = work / 'bootstrap.tfstate'
account = aws('sts', 'get-caller-identity')['Account']
scope = {'account': account, 'region': args.region, 'name': args.name}
scope_file = work / 'scope.json'
if scope_file.exists() and json.loads(scope_file.read_text()) != scope:
    raise RuntimeError('Este diretório operacional pertence a outro ambiente. Use um diretório separado para conta/região/nome.')
scope_file.write_text(json.dumps(scope, indent=2) + '\n')
expected_bucket = f'periferia-tfstate-{account}-{args.region}'
if not state_path.exists():
    try:
        aws('s3api', 'get-object', {'Bucket': expected_bucket, 'Key': 'bootstrap/terraform.tfstate'}, extra=[str(state_path)])
    except AwsFailure as error:
        if error.code != 'NoSuchBucket':
            raise RuntimeError('Não foi possível recuperar o estado do bootstrap. Preserve/recupere o arquivo anterior; não importar ou sobrescrever recursos automaticamente.') from error
extra = ['-state=' + str(state_path), '-var=region=' + args.region]
# -state é argumento de plan; o plano conserva o destino local do bootstrap.
apply(infra / 'state', extra)
backend = json.loads(tf(infra / 'state', 'output', '-state=' + str(state_path), '-json', 'backend', capture=True))
aws('s3api', 'put-object', {'Bucket': backend['bucket'], 'Key': 'bootstrap/terraform.tfstate', 'ServerSideEncryption': 'AES256'}, extra=['--body', str(state_path)])
backend['key'] = args.name + '/terraform.tfstate'
backend_file = work / 'backend.hcl'
backend_file.write_text('\n'.join(k + ' = ' + json.dumps(v) for k, v in backend.items()) + '\n')
tf(infra, 'init', '-input=false', '-reconfigure', '-backend-config=' + str(backend_file))
variables = work / 'deployment.tfvars.json'
previous = json.loads(variables.read_text()) if variables.exists() else {}
remote = outputs(allow_empty=True)
if remote is not None:
    if any(remote.get(key) != value for key, value in [('account_id', account), ('region', args.region), ('name', args.name)]):
        raise RuntimeError('O backend aponta para outro ambiente; não aplicar alterações.')
    previous = previous | {key: remote[key] for key in ['image_digest', 'application_enabled', 'compute_enabled'] if key in remote}
else:
    # Outputs ausentes foram confirmados por uma leitura bem-sucedida. Uma
    # falha de acesso/estado propaga a exceção; nunca equivale a ambiente vazio.
    previous = {'application_enabled': False, 'compute_enabled': False, 'image_digest': None}
if previous.get('application_enabled') and not args.skip_build:
    raise RuntimeError('Ambiente já ativo. Para repetir a validação use --skip-build; uma atualização de imagem exige plano próprio de migração e implantação.')
if args.skip_build:
    if not previous.get('image_digest'):
        raise RuntimeError('--skip-build exige um digest regional previamente publicado.')
    aws('ecr', 'describe-images', {'repositoryName': args.name + '/app', 'imageIds': [{'imageDigest': previous['image_digest']}]})
config = previous | {'region': args.region, 'name': args.name, 'bedrock_model_id': args.bedrock_model_id}
if not previous.get('application_enabled'):
    config['application_enabled'] = False
variables.write_text(json.dumps(config, indent=2) + '\n')
stage('infraestrutura regional')
apply(infra)
deployment = outputs()
config['compute_enabled'] = True
variables.write_text(json.dumps(config, indent=2) + '\n')
stage('capacidade EC2 após associação do Capacity Provider')
apply(infra)
deployment = outputs()
stage('publicação da imagem no ECR regional')
if not args.skip_build:
    auth = aws('ecr', 'get-authorization-token')['authorizationData'][0]
    registry = deployment['ecr_url'].split('/')[0]
    docker_config = Path(env['DOCKER_CONFIG']) / 'config.json'
    descriptor = os.open(docker_config, os.O_CREAT | os.O_WRONLY | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, 'w') as handle:
        json.dump({'auths': {registry: {'auth': auth['authorizationToken']}}}, handle)
    tag = datetime.datetime.now(datetime.timezone.utc).strftime('terraform-%Y%m%d%H%M%S')
    image = deployment['ecr_url'] + ':' + tag
    try:
        with (work / 'image-build.log').open('a') as log:
            subprocess.run([args.docker, 'buildx', 'build', '--platform', 'linux/amd64', '--provenance=false', '--tag', image, '--push', str(root)], env=env, stdout=log, stderr=subprocess.STDOUT, check=True)
    finally:
        docker_config.unlink(missing_ok=True)
    detail = aws('ecr', 'describe-images', {'repositoryName': deployment['ecr_name'], 'imageIds': [{'imageTag': tag}]})['imageDetails'][0]
    config['image_digest'] = detail['imageDigest']
elif not config.get('image_digest'):
    raise RuntimeError('--skip-build exige um digest regional já publicado.')
stage('segredos regionais sem valores no Terraform')
for key, username in [('api-db', 'periferia_api'), ('worker-db', 'periferia_worker')]:
    arn = deployment['secrets'][key]
    existing = existing_secret(arn)
    data = json.loads(existing) if existing else {'password': secrets.token_hex(32)}
    data['url'] = f"postgresql://{username}:{quote(data['password'], safe='')}@{deployment['database_host']}:5432/periferia"
    if not existing or json.loads(existing).get('url') != data['url']:
        put_secret(arn, json.dumps(data))
variables.write_text(json.dumps(config, indent=2) + '\n')
apply(infra)
deployment = outputs()
stage('migration, catálogo e papéis restritos')
deadline = time.monotonic() + 600
while True:
    nodes = aws('ecs', 'list-container-instances', {'cluster': deployment['cluster']})['containerInstanceArns']
    if nodes:
        hosts = aws('ecs', 'describe-container-instances', {'cluster': deployment['cluster'], 'containerInstances': nodes})['containerInstances']
        if any(h.get('agentConnected') and h['status'] == 'ACTIVE' and h.get('capacityProviderName') == args.name + '-ec2' for h in hosts):
            break
    if time.monotonic() > deadline:
        raise TimeoutError('Nenhum host ECS registrado em dez minutos.')
    time.sleep(15)
run = aws('ecs', 'run-task', {'cluster': deployment['cluster'], 'taskDefinition': deployment['task_definitions']['bootstrap'], 'capacityProviderStrategy': [{'capacityProvider': args.name + '-ec2', 'weight': 1}], 'count': 1})
if run.get('failures') or not run.get('tasks'):
    raise RuntimeError('ECS não posicionou a tarefa operacional; confira capacidade e eventos.')
task = run['tasks'][0]['taskArn']
deadline = time.monotonic() + 900
while True:
    status = aws('ecs', 'describe-tasks', {'cluster': deployment['cluster'], 'tasks': [task]})['tasks'][0]
    if status['lastStatus'] == 'STOPPED':
        if any(c.get('exitCode') != 0 for c in status['containers']):
            raise RuntimeError('Bootstrap falhou; consultar logs sanitizados do bootstrap.')
        break
    if time.monotonic() > deadline:
        raise TimeoutError('Bootstrap não terminou em quinze minutos.')
    time.sleep(15)
stage('verificação Bedrock com a IAM Role real da API')
run = aws('ecs', 'run-task', {'cluster': deployment['cluster'], 'taskDefinition': deployment['task_definitions']['api'], 'capacityProviderStrategy': [{'capacityProvider': args.name + '-ec2', 'weight': 1}], 'count': 1, 'overrides': {'containerOverrides': [{'name': 'api', 'command': ['node', 'dist/server/check-bedrock.js']}]}})
if run.get('failures') or not run.get('tasks'):
    raise RuntimeError('ECS não posicionou a verificação Bedrock.')
task = run['tasks'][0]['taskArn']
deadline = time.monotonic() + 600
while True:
    status = aws('ecs', 'describe-tasks', {'cluster': deployment['cluster'], 'tasks': [task]})['tasks'][0]
    if status['lastStatus'] == 'STOPPED':
        if any(c.get('exitCode') != 0 for c in status['containers']):
            raise RuntimeError('Bedrock não disponível para a task API; conferir modelo, IAM e disponibilidade regional.')
        break
    if time.monotonic() > deadline:
        raise TimeoutError('Verificação Bedrock não terminou em dez minutos.')
    time.sleep(15)
stage('ativação dos serviços e autoscaling mínimo 1')
config['application_enabled'] = True
variables.write_text(json.dumps(config, indent=2) + '\n')
apply(infra)
deployment = outputs()
(work / 'deployment.json').write_text(json.dumps(deployment, indent=2) + '\n')
stage('infraestrutura criada; aguardando serviços estáveis')
subprocess.run([args.aws, 'ecs', 'wait', 'services-stable', '--region', args.region, '--cluster', deployment['cluster'], '--services', *deployment['services'].values()], env=env, check=True)
stage('serviços estáveis; verificar jornada HTTP e IA antes de declarar conclusão')
print(json.dumps({'origin': deployment['origin'], 'evidence': str(work / 'deployment.json')}), flush=True)
