"""Gera o relatório técnico a partir do corte de evidências verificado.

Requer reportlab. Uso: python3 scripts/build-report.py
O link do vídeo é entregue separadamente e não integra este documento.
"""
from pathlib import Path
import argparse
import json
from html import escape
from reportlab.pdfgen import canvas
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, KeepTogether
from reportlab.graphics.shapes import Drawing, Rect, String, Line, Polygon
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

parser = argparse.ArgumentParser()
parser.add_argument('--font-dir', type=Path, help='Diretório opcional com LiberationSans-Regular.ttf e LiberationSans-Bold.ttf para incorporar as fontes.')
args = parser.parse_args()
if args.font_dir:
    pdfmetrics.registerFont(TTFont('Helvetica', str(args.font_dir / 'LiberationSans-Regular.ttf')))
    pdfmetrics.registerFont(TTFont('Helvetica-Bold', str(args.font_dir / 'LiberationSans-Bold.ttf')))
    pdfmetrics.registerFontFamily('Helvetica', normal='Helvetica', bold='Helvetica-Bold', italic='Helvetica', boldItalic='Helvetica-Bold')

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / 'docs/evidence/final-20261119'
closure = json.loads((EVIDENCE / 'closure.json').read_text())
assert closure['spDestroyedAndRecreated'] and closure['spNegativeCasesPassed'] == 8
REPO = 'https://github.com/Sorryxk/cloud-project'
OUTPUT = ROOT / 'output/pdf/relatorio-tecnico.pdf'
OUTPUT.parent.mkdir(parents=True, exist_ok=True)
NAVY = colors.HexColor('#173149')
BLUE = colors.HexColor('#345e7c')
MUTED = colors.HexColor('#536575')
PALE = colors.HexColor('#edf3f7')
LINE = colors.HexColor('#d9e2e9')
WIDTH = A4[0] - 84
styles = {
    'body': ParagraphStyle('body', fontName='Helvetica', fontSize=10, leading=14.6, textColor=NAVY, spaceAfter=8),
    'small': ParagraphStyle('small', fontName='Helvetica', fontSize=8.6, leading=12, textColor=MUTED, spaceAfter=7),
    'h1': ParagraphStyle('h1', fontName='Helvetica-Bold', fontSize=21, leading=26, textColor=NAVY, spaceAfter=14),
    'h2': ParagraphStyle('h2', fontName='Helvetica-Bold', fontSize=12, leading=16, textColor=BLUE, spaceBefore=12, spaceAfter=8),
    'cell': ParagraphStyle('cell', fontName='Helvetica', fontSize=9, leading=12.5, textColor=NAVY),
    'label': ParagraphStyle('label', fontName='Helvetica-Bold', fontSize=9, leading=12.5, textColor=NAVY),
}
story = []
def p(text, kind='body'):
    return Paragraph(text, styles[kind])
def add(text, kind='body'):
    story.append(p(text, kind))
def evidence_link(label, path):
    return f'<link href="{REPO}/blob/main/{path}" color="#345e7c">{escape(label)}</link>'

def title(number, text):
    add(number + ' / PERIFERIA', 'small'); add(text, 'h1')
def table(rows, widths=(133, WIDTH-133)):
    data = [[p(escape(str(a)), 'label'), p(escape(str(b)), 'cell')] for a,b in rows]
    t = Table(data, colWidths=list(widths), hAlign='LEFT')
    t.setStyle(TableStyle([
        ('VALIGN',(0,0),(-1,-1),'TOP'), ('LEFTPADDING',(0,0),(-1,-1),10),
        ('RIGHTPADDING',(0,0),(-1,-1),10), ('TOPPADDING',(0,0),(-1,-1),9),
        ('BOTTOMPADDING',(0,0),(-1,-1),9), ('BACKGROUND',(0,0),(0,-1),PALE),
        ('LINEBELOW',(0,0),(-1,-1),0.4,LINE),
    ])); story.append(t); story.append(Spacer(1,8))
def bullet(text):
    add('<b>-</b> ' + text)
def nextpage():
    story.append(PageBreak())
def architecture():
    d=Drawing(WIDTH,255)
    def box(x,y,w,h,lines):
        d.add(Rect(x,y,w,h,rx=6,ry=6,fillColor=PALE,strokeColor=LINE,strokeWidth=0.7))
        for i,text in enumerate(lines):
            d.add(String(x+w/2,y+h/2+5-(i*13),text,textAnchor='middle',fontName='Helvetica-Bold' if i==0 else 'Helvetica',fontSize=9,fillColor=NAVY))
    def arrow(points):
        for a,b in zip(points,points[1:]):d.add(Line(*a,*b,strokeColor=BLUE,strokeWidth=1.1))
        a,b=points[-2:];x,y=b
        if x>a[0]:poly=[x,y,x-5,y+3,x-5,y-3]
        elif x<a[0]:poly=[x,y,x+5,y+3,x+5,y-3]
        else:poly=[x,y,x-3,y+5 if y<a[1] else y-5,x+3,y+5 if y<a[1] else y-5]
        d.add(Polygon(poly,fillColor=BLUE,strokeColor=BLUE))
    box(0,202,90,36,['Visitante','Navegador'])
    box(120,202,80,36,['ALB','Entrada HTTP'])
    box(245,190,WIDTH-245,50,['API NestJS','Frontend React/Vite + regras de negócio'])
    box(0,100,200,55,['Amazon Bedrock','OpenAI GPT-6 Luna / perfil global'])
    box(245,100,WIDTH-245,55,['Worker NestJS','Outbox, SQS e expiração de reservas'])
    box(245,10,120,50,['RDS PostgreSQL','Dados e transações'])
    box(390,10,WIDTH-390,50,['SQS + DLQ','Eventos'])
    arrow([(90,220),(120,220)]);arrow([(200,220),(245,220)])
    arrow([(245,207),(220,207),(220,127),(200,127)])
    arrow([(245,195),(232,195),(232,35),(245,35)])
    arrow([(285,100),(285,60)]);arrow([(450,100),(450,60)])
    return d

story.append(Spacer(1,40))
add('PROJETO SEMESTRAL / COMPUTAÇÃO EM NUVEM','small')
story.append(Spacer(1,14))
story.append(Paragraph('periferia.', ParagraphStyle('brand', fontName='Helvetica-Bold',fontSize=43,leading=48,textColor=NAVY)))
add('Relatório técnico', 'h1')
add('Loja de periféricos com atendimento por IA, reservas de estoque e implantação em duas regiões da AWS.')
story.append(Spacer(1,18))
table([
    ('Integrantes','Moderchai Dov, Enzo Savino, Enrico Berto, Felipe Menke e Arthur Soria.'),
    ('Etapa manual','Ohio / us-east-2. Infraestrutura operada por CLI e console, sem Terraform.'),
    ('Etapa automática','São Paulo / sa-east-1. Infraestrutura criada pelo Terraform, removida e recriada com evidências.'),
    ('IA','Amazon Bedrock com OpenAI GPT-6 Luna. A aplicação se autentica pela role IAM da task.'),
    ('Corte das evidências','19/11/2026. Os testes de carga de 18/11 são históricos e estão identificados separadamente.'),
])
add('Ambientes em execução','h2')
for key,label in [('manual','Ohio - manual'),('automatic','São Paulo - automático')]:
    url=closure['health'][key]['origin']+'/'
    add(f'<b>{label}</b><br/><link href="{url}" color="#345e7c">{url}</link>','small')
add('O link do vídeo de apresentação é entregue separadamente no Blackboard.','small')
nextpage()

title('02','Aplicação e arquitetura')
add('O visitante informa apenas o nome na confirmação. A IA recomenda produtos e negocia condições. A API valida estoque, preço, proposta e consentimento. O frontend exibe os dados fornecidos pela API.')
story.append(architecture())
add('Fluxo lógico replicado nas duas regiões. API e worker executam em containers distintos no ECS, sobre instâncias EC2 em sub-redes privadas. O frontend estático é servido pela API. O Bedrock é um serviço gerenciado com perfil de inferência global, que pode rotear fora da região de origem.','small')
add('Regras implementadas','h2')
bullet('Desconto no carrinho inteiro, limitado pelo backend a 20%. A API avalia pedidos de desconto e valida preços e concessões.')
bullet('Antes de reservar, o cliente recebe o resumo e confirma explicitamente. Mudanças de carrinho ou estoque exigem proposta atualizada e nova confirmação.')
bullet('A reserva dura 15 minutos, pode ser cancelada e libera o estoque uma única vez. São permitidas várias reservas, respeitando a disponibilidade.')
bullet('Pedidos repetidos de confirmação são idempotentes. Outbox transacional, consumo idempotente e varredura de contingência tratam entrega duplicada e falha de publicação.')
add('Tecnologias: TypeScript, React/Vite, NestJS, PostgreSQL/Prisma, Docker, ECS/EC2, ALB, SQS, Secrets Manager, CloudWatch e Terraform.','small')
nextpage()

title('03','Etapa manual em Ohio')
add('A equipe implantou a infraestrutura de Ohio pelo Console AWS e pela AWS CLI. Todos os resultados desta página foram registrados em Ohio antes da migração para o Bedrock.')
table([
    ('Rede','VPC com duas AZs, sub-redes públicas para ALB/NAT e privadas para os hosts; banco isolado. Dois NAT Gateways conforme decisão do projeto.'),
    ('Containers','API e worker independentes. Mínimos: 1 API, 1 worker e 1 EC2. Máximos configurados: API 6, worker 4 e EC2 4.'),
    ('Dados','RDS PostgreSQL Single-AZ, privado e criptografado, backup de 7 dias. Roles DB separadas para API e worker.'),
    ('Operação','Logs por 30 dias, dashboard, alarmes e Budget. Expansão pelos sinais de carga e fila; redução respeita as tarefas em execução.'),
])
add('Elasticidade e recuperação em Ohio','h2')
table([
    ('Escala de tasks','API: 1 → 3 → 2 → 1 em 16/11. Worker: 1 → 4 → 1 por backlog no ensaio de 18/11, com 24.680 reentregas de 12 eventos.'),
    ('Escala de EC2','Capacity Provider: expansão de 1 para 3 instâncias em 16/11, com dois lançamentos concluídos. Redução automática de 2 para 1 em 18/11.'),
    ('Drenagem e persistência','1.761 respostas HTTP 200 em 1.761 consultas ao catálogo, com p95 de 630,6 ms. A reserva permaneceu visível durante a troca, com duas réplicas da API no ensaio.'),
    ('Vazão observada','O consumo passou de 2.431 para 8.003 mensagens por minuto, uma diferença de 3,29 vezes na comparação observacional.'),
    ('Outbox com falha real','Negação de publicação gerou duas tentativas falhas. Contingência expirou a reserva 16,202 s após o prazo; recuperação publicou sem liberar estoque em duplicidade.'),
    ('Sonda longa','1.007 respostas HTTP 200 em 1.011 tentativas. Quatro erros ocorreram após uma pausa local, com causa indeterminada.'),
])
add('Evidências de Ohio: ' + ' | '.join([
    evidence_link('API', 'docs/evidence/aws-api-scaling-activities.json'),
    evidence_link('Worker', 'docs/evidence/manual-validation-20261118/final-worker-scaling.json'),
    evidence_link('Expansão EC2', 'docs/evidence/aws-ec2-scaling-activities.json'),
    evidence_link('Redução EC2', 'docs/evidence/manual-validation-20261118/final-ec2-scaling.json'),
    evidence_link('Drenagem', 'docs/evidence/manual-validation-20261118/drain-summary.json'),
    evidence_link('Método e resultados', 'docs/ensaios-manual-fase2.md'),
]), 'small')
nextpage()

title('04','Terraform e recriação de São Paulo')
add('O script público configura o backend, aplica a infraestrutura regional, publica a imagem no ECR da região, configura os segredos em memória, executa migrações, carrega o catálogo inicial e concede permissões no banco, testa o Bedrock pela role real da API e ativa os serviços.')
table([
    ('Parametrização','Conta, região e nome são validados. AMI e AZs vêm da região de destino. O repositório ECR, RDS, filas, roles e demais recursos pertencem a São Paulo.'),
    ('Estado remoto','Bootstrap e aplicação usam S3 com versionamento, criptografia, bloqueio público e lock nativo. Chaves distintas; bucket preservado na remoção da aplicação.'),
    ('Segredos','O Terraform cria metadados de segredos, sem SecretString no state. O RDS gerencia a credencial master; API e worker usam referências regionais distintas.'),
])
add('Ciclo executado em 19/11','h2')
bullet('Plano inicial revisado: 103 recursos do ambiente periferia-sp, sem bucket de estado e sem recursos de Ohio. Snapshot final obrigatório e recuperação dos segredos de aplicação por sete dias.')
bullet('A primeira remoção falhou após remover conectividade antes do encerramento das tasks. Houve recuperação temporária da rede e retomada: 57 recursos restantes removidos, exit code 0 e state vazio. A rede temporária foi removida.')
bullet('A dependência de rede do teardown foi corrigida. A validação da correção requer um novo ciclo completo de destruição e recriação.')
bullet('O snapshot periferia-sp-final-14540aef ficou disponível. Ohio e o bucket de estado permaneceram preservados. A criação usou cópia limpa do commit 9f31818 e novo diretório operacional, sem IDs antigos nem restauração do banco anterior.')
bullet('A instalação nova recebeu catálogo inicial, passou nos testes e apresentou plano final sem diferenças. A correção visual posterior, do commit 0af314f, foi implantada nos dois ambientes.')
add('Fontes: docs/evidence/final-20261119/sp-destroy-closure.json, sp-teardown-recovery.json, sp-recreated-progress.json, sp-recreated-noop.txt e closure.json.','small')
nextpage()

title('05','Validação da instalação atual')
table([
    ('Saúde','As duas origens responderam HTTP 200 em /health/ready. API e worker da instalação nova estabilizaram com uma task de cada serviço.'),
    ('Jornada nova de SP','26 etapas HTTP: carrinho manual 1, 2, 1 e remoção; resumo, três conversas com Bedrock, contraproposta, tentativa de jailbreak, confirmação e cancelamento.'),
    ('Reserva e estoque','Identidade preservada na confirmação repetida; prazo de 900 segundos. Estoque do teclado variou de 12 para 11 após reservar e voltou a 12 após cancelar.'),
    ('Negativos HTTP','Oito casos rejeitados e cinco invariantes preservados na execução isolada: sessão, origem, formato de entrada e consentimento.'),
    ('Runtime de SP','API e worker com TLS no PostgreSQL, roles distintas, UID 1000, capabilities zero e no-new-privileges. Escrita de preço negada e acesso ao IMDS bloqueado.'),
    ('Estado remoto','Valores reais de três segredos comparados somente em memória com ambos os states. Nenhum valor encontrado; nenhum literal de Ohio nesses estados.'),
    ('Formatação do chat','Negrito e listas tratados no frontend, inclusive durante streaming. HTML bruto, imagens e links do modelo não são habilitados. Conversa de Ohio conferida visualmente.'),
])
add('Verificação visual e condições do ensaio','h2')
add('São Paulo foi aberto no Safari e passou nos cliques de adicionar, aumentar, diminuir, conferir resumo, informar nome, confirmar a reserva e cancelar após confirmação explícita. A reserva de teste foi cancelada, o estoque voltou a 10 unidades do Headset Connect e o carrinho ficou vazio. Evidência: sp-safari-ui-smoke.json.')
add('Uma execução dos negativos coincidiu com a reserva da jornada e detectou variação no estoque público. Os registros foram preservados e o ensaio isolado posterior passou. Essa interferência de teste não foi apresentada como falha de isolamento de sessão.')
add('Fontes: sp-recreated-real-journey.json, sp-recreated-guardrails-http.json, sp-recreated-api-runtime.json, sp-recreated-worker-runtime.json e sp-recreated-state-security-audit.json, em docs/evidence/final-20261119/.','small')
nextpage()

title('06','Operação, limitações e entrega')
add('Controles e limitações operacionais','h2')
bullet('A inferência usa IAM de task e Bedrock; o worker não recebe permissão de inferência. O modelo não é a autoridade de preço, estoque ou confirmação. O tratamento visual do Markdown não altera as regras comerciais.')
bullet('A conexão com PostgreSQL usa TLS. O acesso público usa HTTP, o que deixa o cookie de sessão sem proteção de HTTPS em trânsito.')
bullet('O scan da imagem atual registrou 6 achados HIGH, 11 MEDIUM e 4 LOW em cada região. Os achados permanecem mesmo com os controles de execução do container.')
bullet('RDS é Single-AZ por decisão do projeto. A capacidade sustentada nos máximos configurados ainda precisa ser medida, considerando o consumo de CPU e os créditos das instâncias T3.')
bullet('O AWS Budgets acompanha o limite de US$ 100. Em 19/11, às 11:29 UTC, o acumulado da conta era de US$ 12,514. Os dois orçamentos usam a mesma base de cobrança. Os NAT Gateways e os recursos em execução geram custos também sem tráfego.')
add('Material de entrega','h2')
table([
    ('Relatório','Este documento descreve comportamento, arquitetura, resultados e limitações, com referência às evidências verificadas.'),
    ('GitHub','Código, Terraform e evidências publicados em github.com/Sorryxk/cloud-project.'),
    ('Vídeo separado','Apresentação gravada com 13 min 05 s. O link será enviado separadamente no Blackboard.'),
])
add('Documentos para reprodução e revisão','h2')
add('README-ENTREGA.md; docs/aws-manual.md; infra/terraform/README.md; docs/recriar-sao-paulo.md; docs/bedrock.md; docs/operacao-incidentes.md; docs/avaliacao-rubrica.md; docs/avaliacao-terraform.md. Os pareceres distinguem evidência comprovada de lacunas para A+; a nota cabe ao professor.','small')

def chrome(c,doc):
    c.saveState()
    if doc.page>1:
        c.setFont('Helvetica-Bold',9);c.setFillColor(BLUE);c.drawString(42,A4[1]-31,'periferia. / computação em nuvem')
        c.setStrokeColor(LINE);c.line(42,A4[1]-39,A4[0]-42,A4[1]-39)
    c.setStrokeColor(LINE);c.line(42,39,A4[0]-42,39)
    c.setFont('Helvetica',8);c.setFillColor(MUTED);c.drawString(42,26,'Corte verificado: 19/11/2026 | Projeto semestral')
    c.drawRightString(A4[0]-42,26,str(doc.page))
    c.restoreState()

doc=SimpleDocTemplate(str(OUTPUT),pagesize=A4,rightMargin=42,leftMargin=42,topMargin=57,bottomMargin=53,title='Periferia - Relatório técnico de Computação em Nuvem',author='')
doc.build(story,onFirstPage=chrome,onLaterPages=chrome)
print(OUTPUT)
