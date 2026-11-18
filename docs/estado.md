# Estado verificado e próximo passo

Atualizado em 18/11/2026. Etapa manual validada em A com ressalvas; Terraform implantou um ambiente funcional em São Paulo. A criação/destruição completa ainda depende de autorização para o ensaio destrutivo. O usuário autorizou manter os ambientes ligados. Detalhes atuais em `terraform-sp.md` e no parecer independente; os registros de Ohio abaixo preservam o histórico da primeira etapa.

## Aplicação e testes locais

- React/TypeScript/Vite, API e worker NestJS, PostgreSQL/Prisma, SQS com outbox transacional.
- 12 produtos fictícios, catálogo persistente, negociação limitada pelo backend, confirmação explícita, reservas de 15 minutos e cancelamento/expiração idempotentes.
- 16 testes focados de domínio/mensageria e 4 testes HTTP aprovados. Os 4 testes HTTP também passaram no container com 0,25 CPU e 512 MiB.
- Typecheck e build aprovados. Os 4 testes de regressão para compatibilidade HTTP com ALB passaram após corrigir CSP e remover a dependência de crypto.randomUUID no navegador HTTP. Evidência: `evidence/http-alb-compatibility.tap`.
- Prévia de 390 px sem overflow; capturas desktop/móvel em `evidence`. Medição local de 100 consultas/10 sessões: todas 200, p95 aproximadamente 12,9 ms. Não representa AWS ou IA real.

## AWS criada e verificada

- VPC própria, duas AZs, seis sub-redes, duas NAT, IGW, rotas privadas e endpoint gateway S3. EC2 e banco sem IP público; acesso externo pelo ALB.
- RDS PostgreSQL 17.11 Single-AZ, db.t4g.micro, 20 GiB gp3, criptografado, privado, backup 7 dias e proteção contra exclusão.
- Migration, seed e criação/grants dos papéis restritos concluídos pela tarefa operacional `periferia-bootstrap:2`, exit code 0, log `bootstrap.completed`.
- Primeira tentativa de migração falhou na cadeia de confiança TLS do Prisma CLI. A revisão 2 acrescentou o bundle confiável a SSL_CERT_FILE/NODE_EXTRA_CA_CERTS, mantendo validação estrita. API e worker validam o certificado explicitamente pelo adapter PostgreSQL.
- Varredura ECR da imagem amd64 concluída: 7 achados HIGH, 4 MEDIUM, 4 LOW e 1 UNDEFINED. `apt-get update` e simulação de upgrade não encontraram pacotes atualizáveis na base consultada. Achados e versões em `evidence/ecr-high-findings.json`; não foi demonstrada exploração pela aplicação, nem correção completa. Execução sem root e filesystem somente leitura nas tasks de aplicação reduzem exposição, mas não eliminam esses achados.
- Imagem linux/amd64 `manual-20261116-v3` no ECR de Ohio, referenciada por digest nas task definitions.
- ECS sobre EC2 com Launch Template v2, AMI regional obtida por SSM, t3.small, disco gp3 30 GiB criptografado, IMDSv2 obrigatório e bloqueio do IMDS para containers. Root mínimo de 30 GiB exigido pela AMI, corrigido após validação inicial do ASG.
- ASG mínimo 1, máximo 4, com desejado ajustado pelo Capacity Provider, duas sub-redes privadas. Capacity Provider com managed scaling, managed draining e proteção de término. Host inicial saudável na AZ b.
- Dois serviços ECS criados. Worker desejado 1, executando e saudável. API ativada com Luna real; v3 e task definitions API:2/worker:2 implantadas com rollout COMPLETED. Mínimos elevados temporariamente para 2 nos testes de disponibilidade e restaurados para 1 em seguida.
- Rede bridge, API com porta dinâmica do host; worker sem porta publicada. 256 unidades de CPU e reserva/limite de 512 MiB por task. Host registrou 1.657 MiB utilizáveis: até três tasks por memória; verificar uso real antes de sustentar dez tasks em quatro hosts.
- SQS Standard e DLQ com criptografia gerenciada, redrive após cinco recebimentos; worker acessa a fila por task role. Mensagem inválida testada: cinco retentativas observadas e encaminhamento confirmado à DLQ. Alarme da DLQ entrou em ALARM e a ação SNS foi executada com sucesso; evidências em evidence/aws-dlq-alarm.json e evidence/aws-dlq-alarm-action.json. A mensagem descartável foi removida após a coleta.
- IAM separado para EC2, execution roles, task role API e task role worker. Senhas somente no Secrets Manager; credencial master usada apenas na tarefa operacional.
- Smoke test remoto: 12 produtos, papel periferia_worker, TLS verdadeiro, readiness 200, bloqueio IMDS confirmado no container e regra presente no host.
- Logs com retenção de 30 dias, Container Insights, dashboard Periferia-Ohio e 18 alarmes operacionais (incluindo OutboxFailures, acrescentado e ensaiado em 18/11). Política de escala worker aplicada: alvo inicial de 10 mensagens/task; API aplicada com alvo de 300 requisições/alvo/minuto. Ambos exigem calibração por carga.
- Budget mensal US$ 100 com avisos 25/50/75/90% e previsão 100% para SNS. Não é bloqueio de gastos. Tópico sem assinatura externa; não foi enviado e-mail a terceiros.

IDs, ARNs e revisões em `aws-inventory.json`; esse inventário registra respostas de criação e leituras posteriores, portanto campos de estado antigos de criação não substituem consultas atuais. JSONs `*-ohio.json` registram as entradas usadas manualmente na CLI, sem Terraform/CloudFormation/CDK.

## Próximo passo concreto

O usuário salvou a chave diretamente na AWS; a formatação foi normalizada sem exibir o valor. Jornada com Luna real validada antes e depois das correções v3. API 1–6, worker 1–4 e EC2 1–4. Drenagem ocupada, escala completa do worker e falha/recuperação real da outbox concluídas em 18/11. A reavaliação independente deve fechar o parecer antes da etapa automática em São Paulo. Consultar `ensaios-manual-fase2.md` e a matriz de evidências.

## Ainda não comprovado

Carga de IA real com 50 usuários; corrida cancelamento × expiração AWS; custos reais consolidados. Subida/descida do worker, drenagem ocupada e falha/recuperação da outbox passaram em 18/11, com limites documentados. O primeiro teste de 50 visitantes ao catálogo teve 2.712 respostas 200 e 24 falhas de rede (2.736 tentativas); p95 de 660 ms, duração real 585 s. Coincidiu com rollout do segredo, mas a causa das falhas não foi demonstrada. A repetição sem rolling deploy teve 50 visitantes, 2.400 respostas 200, zero falhas, p95 de 475,8 ms e p99 de 1.113,4 ms em 183,75 s; cobre somente consultas ao catálogo. Não isola a causa das falhas anteriores. Não atribuir A+ sem evidências.

Mínimo 1 admite interrupção em falha abrupta; disponibilidade deve ser demonstrada com pelo menos duas réplicas e dois hosts. RDS Single-AZ tem ponto único de indisponibilidade. HTTP serve à demonstração com dados fictícios. Preços regionais consultados indicam base de aproximadamente US$ 0,1693/h antes de armazenamento, métricas, tráfego e escala; manter o ambiente ligado não garante um mês dentro de US$ 100.

## Continuidade

Código em `src/server`, `apps/web`, `prisma`, `infra` e `docs`. Nenhum repositório remoto ou PR foi aberto. Nenhum dado essencial depende do disco das tasks. Processos de prévia e containers locais de teste podem ser encerrados sem perder o código; não remover o volume PostgreSQL sem decidir sobre os dados locais.

## Evidências adicionais da etapa manual

- `evidence/aws-real-journey.json` e `aws-real-journey-v3.json`: a IA consultou o catálogo, persistiu uma proposta e negociou. A tentativa de obter 90% de desconto e confirmar pelo chat foi rejeitada. O botão confirmou a reserva de forma idempotente; a reserva da repetição v3 foi cancelada após a coleta.
- `evidence/aws-stock-concurrency.json`: a disputa pela última unidade retornou 201 para um visitante e 409 para outro. O cancelamento entre sessões foi negado. O estoque original foi restabelecido após cancelar somente as reservas do teste.
- `evidence/aws-api-scaling-activities.json`: API de 1 para 3, depois 2 e 1, por métrica do ALB. `aws-ec2-scaling-activities.json`: EC2 de 1 para 3 pelo Capacity Provider.
- `evidence/aws-availability-task.json`: 219 de 219 respostas HTTP 200, com reserva e conversa preservadas durante a substituição de uma task.
- `evidence/aws-availability-probe.json`: 216 de 216 respostas HTTP 200 após a perda de EC2, com estado preservado. A sonda começou cerca de 10 segundos depois do comando de término; a janela inicial não foi amostrada. O ASG substituiu a instância e recuperou as tasks. Histórico em `aws-ec2-recovery-activities.json`.
- `evidence/aws-expiration-database.json`: prazo comercial de 900 segundos, estado EXPIRED gravado no banco 0,639 segundo após o vencimento e estoque reservado do key-01 igual a zero. A injeção de falha IAM não impediu o envio nessa tentativa; portanto, não comprova falha de outbox. As políticas temporárias de negação foram removidas.
- `evidence/aws-ai-recovery-v3.json`: probe real do SDK/Luna, lease exclusiva entre réplicas e manutenção do bloqueio diante de credencial inválida. O teste usou um registro Dependency isolado; o gate dos clientes foi preservado.
- `evidence/audit-regressions.tap`: 11 regressões aprovadas para negociação em todas as rodadas, probe/CAS e listagem de todas as reservas ativas. Typecheck e build aprovados; imagem v3 implantada por digest.
- A prévia local foi restaurada depois da parada do Vite e da API. O clique em Adicionar Teclado foi validado no navegador. Captura em `evidence/carrinho-local-corrigido.png`. O modo local continua simulado, claramente identificado.

Auditorias independentes: `auditoria-roteiro.md`, `auditoria-aplicacao.md` e `auditoria-infra.md`. A avaliação em `avaliacao-rubrica.md` distingue o corte de cada evidência e a etapa manual do projeto final com Terraform.

## Fechamento da coleta

- `evidence/aws-load-catalog-50-stable.json`: 50 visitantes, 2.400 consultas HTTP 200, nenhuma falha e p95 de aproximadamente 476 ms. A API escalou novamente de 1 para 3, conforme o snapshot das 14:16 UTC (11:16 de Brasília). O atraso entre carga, métricas e scale-out ainda merece calibração. Não foram simuladas 50 conversas com IA.
- `evidence/aws-ec2-final-activities.json`: remoção automática bem-sucedida de uma EC2 vazia, reduzindo a frota de 3 para 2. A proteção havia impedido uma tentativa de scale-in com tasks presentes. Isso não comprova drenagem de um host ocupado sob carga.
- `evidence/aws-duplicate-processing.json` e `aws-duplicate-iam-verification.json`: duas mensagens com o mesmo eventId foram processadas, mas existe uma única linha ProcessedEvent e o estoque permanece em 12 unidades, com zero reservadas. O worker acessou a fila própria e recebeu negação HTTP 403 na DLQ, conforme seu IAM.
- `evidence/aws-final-scaling-limits.json`: API de 1 a 6 e worker de 1 a 4; ASG de 1 a 4. No snapshot das 14:16 UTC, havia 3 API tasks, 1 worker e 2 EC2 por efeito da carga. O mínimo de 1 não obriga o desejado a permanecer em 1.
- A DLQ estava vazia ao fechar a coleta, e nenhuma política temporária de falha permanecia. O ambiente foi mantido ligado por autorização do usuário; custos e alertas continuam ativos.

## Fechamento adicional de 18/11

Drenagem: 1.761/1.761 consultas HTTP 200, p95 630,6 ms. Worker: 24.680 replays, política automática 1→4→3→2→1; EC2 voltou automaticamente a 1. Outbox: envio negado de fato, duas falhas, recuperação do estoque 16,202 s após vencimento, publicação na terceira tentativa e um ProcessedEvent. Oito negativos HTTP passaram.

Snapshot final das 13:27:42 UTC: uma API, um worker, uma EC2 saudável, nenhum pendente, fila e DLQ vazias. Mínimos 1, máximos API 6/worker 4/EC2 4, sem política temporária de negação. Produtores e monitores encerrados; AWS permanece ligada. A sonda longa teve 1.007 respostas 200 e quatro erros após lacuna local, causa não isolada. Triagem da imagem por digest, análise de capacidade e runbook disponíveis. A+ permanece sujeito à avaliação e às limitações explícitas; Terraform ainda não foi implementado.

## São Paulo operacional

Origem: http://periferia-sp-2059630122.sa-east-1.elb.amazonaws.com. Jornada Luna real e oito negativos HTTP aprovados; API/worker com TLS, papéis distintos, IMDS bloqueado e NoNewPrivs. Terraform final sem mudanças; comparação de segredos não encontrou valores no state. Mínimos/desejados observados: uma API, um worker e uma EC2. Plano de destruição somente preparado, nenhuma exclusão executada. Consultar `terraform-sp.md` para limites e próximos passos.
