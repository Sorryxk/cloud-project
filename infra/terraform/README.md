# Ambiente automático em São Paulo

Esta etapa reconstrói a infraestrutura em `sa-east-1`. A construção manual e suas evidências permanecem em Ohio. O módulo `modules/platform` cria recursos novos e recebe região, nome, CIDR, digest e controles de ativação; não importa recursos da primeira etapa.

## Implantação

O [backend S3 da HashiCorp](https://developer.hashicorp.com/terraform/language/backend/s3) documenta o versionamento e o lock nativo usados aqui.

Requisitos: Python 3, botocore (`python3 -m pip install -r scripts/requirements-aws.txt`), AWS CLI, Terraform 1.10 ou superior e Docker com buildx. Configure credenciais temporárias pela cadeia padrão da AWS e mantenha um diretório operacional privado e persistente. Não adicione credenciais ao provider, ao backend ou aos arquivos tfvars.

Execute a partir da raiz do projeto:

```sh
python3 scripts/deploy-terraform.py \
  --region sa-east-1 \
  --name periferia-sp \
  --work-dir /caminho/privado/periferia-deploy
```

A inferência usa Amazon Bedrock e a IAM Role da task API, sem chave OpenAI. O modelo padrão é `global.openai.gpt-6-luna`, configurável por `--bedrock-model-id`. O modelo e o perfil precisam estar disponíveis na conta e na região escolhida. O script não aceita termos nem configura assinaturas do Marketplace automaticamente. O perfil global pode encaminhar o processamento para outras regiões AWS; isso não cria dependência dos recursos da loja em Ohio.

O ASG nasce com capacidade zero até a associação do Capacity Provider; uma fase explícita eleva o mínimo para um antes do bootstrap. O script valida e aplica planos salvos: infraestrutura com serviços parados, publicação da imagem regional, configuração dos segredos e migração, teste Bedrock com streaming e ferramentas pela role da API e ativação. O autoscaling recebe mínimo 1 após o bootstrap. O prazo comercial de reservas permanece 15 minutos.

Os logs operacionais ficam no diretório privado informado. Consulte `progress.json`, `terraform-state.log`, `terraform-app.log` e `image-build.log` se uma fase falhar; corrija a causa e execute novamente com o mesmo diretório. O seed cria apenas produtos ausentes e não redefine o estoque existente. `--skip-build` exige um digest regional já publicado. A criação de serviços estáveis ainda deve ser seguida de jornada real HTTP/IA antes de declarar sucesso.

## Estado e segredos

O bootstrap Terraform cria um bucket S3 com versionamento, criptografia, bloqueio público e política exigindo TLS. Tanto o bootstrap quanto a aplicação usam backend S3 com `use_lockfile=true`, em chaves distintas: `bootstrap/terraform.tfstate` e `<nome-do-ambiente>/terraform.tfstate`. Não é necessária uma tabela DynamoDB. Consulte a [documentação do backend S3](https://developer.hashicorp.com/terraform/language/backend/s3).

O script copia somente os arquivos de configuração e o lockfile de providers do bootstrap para `bootstrap-source/state`, dentro do diretório operacional privado, e gera ali a configuração do backend. Não copia estados ou planos da raiz entregue. Quando o bucket já existe, confere a conta proprietária, a região e o bucket identificado no estado remoto antes de inicializar e aplicar o bootstrap diretamente no S3. A leitura desse estado não é uma cópia local usada como fonte de verdade; planos e aplicações usam o backend remoto com locking nativo.

Somente a primeira criação do bucket exige estado local transitório, pois o destino remoto ainda não existe. O script migra esse estado para o S3 antes de criar os recursos da aplicação. Não executar duas primeiras criações do mesmo bucket em paralelo. Se houver interrupção antes da migração, repetir com o mesmo diretório operacional: a recuperação aceita o estado transitório desse escopo quando a chave remota está ausente e o bucket corresponde ao esperado. Erros de acesso ou divergências não autorizam importação nem sobrescrita automática. Preserve o diretório para recuperação; não edite ou substitua o estado manualmente.

Para aplicar ou verificar somente os recursos do bootstrap, sem inicializar nem alterar a infraestrutura da aplicação, use os mesmos pré-requisitos e credenciais:

```sh
python3 scripts/deploy-terraform.py \
  --region sa-east-1 \
  --name periferia-sp \
  --work-dir /caminho/privado/periferia-deploy \
  --bootstrap-only
```

`--bootstrap-only` executa o plano e a aplicação do bootstrap; não é uma operação exclusivamente de leitura. O script encerra essa execução após confirmar o backend remoto. O arquivo `scope.json` impede reutilizar o diretório operacional para outra conta, região ou nome. O bucket de estado possui `prevent_destroy` e permanece fora da remoção da aplicação, permitindo reconstruí-la pelo estado remoto preservado.

O RDS administra a senha master no Secrets Manager. As senhas dos papéis de aplicação são geradas em memória e enviadas diretamente ao Secrets Manager. Os recursos Terraform de segredos criam somente metadados; não há secret_version ou leitura de SecretString no state. A tarefa operacional recebe referências de segredos e aplica migration, seed e grants privados. API e worker recebem credenciais distintas e não usam a credencial master.

## Dependências regionais

- AZs disponíveis são consultadas na região do provider; a VPC usa as duas primeiras.
- A AMI ECS/AL2023 vem do parâmetro público SSM da própria região.
- Imagem Linux/amd64 é construída do código local e publicada no ECR regional; tasks usam digest imutável.
- RDS, filas, DLQ, logs, segredos, ALB, endpoint S3 e políticas referenciam os recursos recém-criados.
- Papéis IAM são globais na conta e recebem o prefixo do ambiente. Use nomes diferentes para implantações simultâneas em regiões distintas.

Preservam-se as decisões aprovadas: duas NAT, RDS Single-AZ, ALB HTTP para demonstração fictícia, tarefas de 256 CPU/512 MiB, API até 6, worker até 4 e EC2 até 4. O transporte HTTP e os achados residuais da imagem continuam limitações; Terraform não os elimina. Os alarmes possuem ação SNS, mas não há envio para terceiros nem assinante externo configurado.

## Reprodutibilidade e destruição

Após a implantação, validar ausência de mudanças com novo plan e registrar IDs, região, AMI, digest, saúde, persistência, IAM e uma jornada com IA real. Não reutilizar os resultados de Ohio como prova de funcionamento em São Paulo.

O script de implantação **não executa destroy**. A remoção precisa de autorização explícita, plano concreto e conferência do destino. Há proteção de exclusão no ALB/RDS, snapshot final obrigatório, recuperação de segredos por sete dias e proteção contra exclusão do bucket de estado. O ECR não permite exclusão implícita de repositório com imagens. Essas proteções exigem uma etapa de desligamento deliberada; não usar force para contorná-las silenciosamente. O professor exige demonstração de criação/destruição para os níveis superiores: o plano de remoção e sua execução autorizada devem ser registrados separadamente.

Um mínimo de uma réplica admite interrupção em falha abrupta. Duas NAT, ALB e RDS continuam cobrando com pouco tráfego; US$ 100 é um alerta mensal, não bloqueio automático de gastos. Os dois ambientes ligados somam custos. O usuário autorizou mantê-los ligados; não há rotina de desligamento agendada.
