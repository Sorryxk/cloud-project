# Matriz do enunciado

Fonte: `Projeto_Semestral_Computacao_em_Nuvem.pdf`, páginas 1 a 7, fornecido pelo usuário. Escopo: etapa manual em Ohio (`us-east-2`) e reconstrução funcional com Terraform em São Paulo (`sa-east-1`). Os ensaios de carga/resiliência abaixo pertencem a Ohio, salvo indicação explícita de São Paulo. Esta matriz distingue configuração, demonstração e pendência; não atribui conceito.

| Requisito | Evidência concluída | Pendência ou limite |
| --- | --- | --- |
| MVP com IA e funções reais | Jornada com Luna real: catálogo, carrinho, proposta persistente, negociação e confirmação pela API; repetida na v3 | Ampliar testes adversariais e carga com IA real |
| Docker e ECS sobre EC2 | Imagem amd64 no ECR de Ohio; API e worker na revisão 2, v3, saudáveis | Não foi usada capacidade Fargate |
| ECR da região | Repositório regional, tags imutáveis e imagem por digest | Também publicado e executando no ECR de São Paulo; sem referência runtime ao ECR de Ohio |
| ASG e Capacity Provider | Launch Template regional; managed scaling, draining e proteção de término; EC2 de 1 para 3 | Drenagem ocupada repetida em 18/11: 1.761/1.761 HTTP 200; retirada após esvaziamento |
| Elasticidade de tasks e EC2 | API de 1 para 3 e retorno para 1; frota de 1 para 3 e remoção de 3 para 2 | Worker 1→4→3→2→1 por política; EC2 voltou automaticamente a 1 em 18/11 |
| VPC própria em duas zonas | Seis sub-redes, rotas, duas NAT e SGs efetivos conferidos | RDS Single-AZ é decisão explícita e limitação de disponibilidade |
| ALB e acesso controlado | ALB em duas zonas, targets saudáveis, hosts privados e portas dinâmicas restritas ao ALB | HTTP com dados fictícios; cookie sem proteção TLS em trânsito |
| Health checks e substituição | Task reposta, 219/219 consultas HTTP 200; EC2 perdida e reposta pelo ASG | Sonda EC2 teve 216/216 respostas 200, mas iniciou cerca de 10 segundos após o comando de término |
| Persistência externa | RDS privado/criptografado, backup de 7 dias, migração e papéis restritos; conversa e reserva preservadas | RDS Single-AZ não possui failover entre zonas |
| Dois serviços com perfis distintos | Atendimento síncrono e worker assíncrono; escala por ALB e backlog por task, respectivamente | 24.680 replays; média de 2.431 exclusões/min com um worker e 8.003/min na janela com quatro; não equivale a vendas |
| Assíncrono, repetição e DLQ | SQS/outbox; mensagem inválida repetida cinco vezes e enviada à DLQ; alarme e ação SNS; duplicata não liberou estoque novamente | Falha real 403 e duas tentativas pendentes em 18/11; recuperação do estoque em 16,202 s, reenvio e ProcessedEvent único |
| CPU, memória e posicionamento | CPU 256, reserva/limite de 512 MiB por task; bridge; host com 1.657 MiB disponíveis; estratégia registrada | Máximos de 6 API tasks e 4 workers em quatro hosts ainda não foram ensaiados sob carga sustentada |
| Segredos fora do código | Secrets Manager e referências por ARN; chave inserida pelo usuário por último; imagem sem `.env` | Não divulgar os arquivos operacionais privados de autenticação |
| IAM Roles distintas | Papéis EC2/execution/task separados; worker negado em outra fila e em dados de sessão/preços no PostgreSQL | Triagem contínua das permissões e das vulnerabilidades da imagem |
| CloudWatch | Logs por 30 dias, Container Insights, dashboard e 18 alarmes; alarme DLQ/SNS acionado de fato | SNS sem assinante externo; OutboxFailures agora possui alarme ensaiado e runbook; déficit relativo de tasks continua melhoria |
| Disponibilidade e integridade | Sondas de task/EC2, concorrência 201/409, confirmação idempotente e expiração real em 15 minutos com atraso de 0,639 segundo | Mínimo de uma réplica admite interrupção abrupta; corrida cancelamento × expiração foi validada localmente |
| Diagrama e inventário manual | Diagrama em `aws-manual.md`, IDs/ARNs e revisões em `aws-inventory.json`, evidências em `evidence/` | Entradas históricas de criação não substituem snapshots atuais |
| Terraform em São Paulo | Ambiente funcional novo, módulo parametrizado, AMI/AZs regionais, imagem regional, backend S3 protegido e plan sem mudanças; jornada Luna/guardrails/hardening conferidos | Destruição/recriação ainda não executada; plano inicial de 102 recursos já autorizado; atualizar o plano após Bedrock e executar o ciclo. Ver `terraform-sp.md` |

## Leitura da carga

A primeira execução de 50 visitantes ao catálogo teve 2.712 respostas HTTP 200 e 24 falhas de rede, em 2.736 tentativas. Coincidiu com trocas de tasks; isso não comprova a causa das falhas. Na repetição sem rolling deploy, foram 2.400 respostas HTTP 200, nenhuma falha e p95 de aproximadamente 476 ms. Ambas medem consultas ao catálogo, não 50 conversas com IA. A repetição também levou a API de 1 para 3 tasks, com o atraso normal das métricas e da política ainda sujeito a calibração.

## O que não é obrigatório

Painel administrativo, atualização de catálogo pelo cliente, pagamento real, entrega física, domínio próprio, certificado ACM, CI/CD, dois NAT Gateways e RDS Multi-AZ não são exigências explícitas. O PDF não fixa um máximo de containers/tasks. A+ depende das evidências e da robustez, não da quantidade de serviços.

## Transação comercial com IA

A IA consulta dados reais e persiste carrinho/proposta pelas ferramentas. A reserva só é gravada pela API depois da confirmação explícita do resumo. As ferramentas da IA não têm operação de confirmar ou cancelar em nome do cliente. Na apresentação, mostrar a jornada completa e a persistência, com as limitações observadas.

A avaliação independente, separada desta matriz, está em `avaliacao-rubrica.md`.

## Fechamento de 18/11

Os três ensaios adicionais foram concluídos; detalhes e limites em `ensaios-manual-fase2.md`. A sonda longa teve 1.007 respostas 200 e quatro erros de timeout/DNS após lacuna local, sem causa isolada. Não confundir esse total com as 1.761 consultas sem erro na janela de drenagem. Snapshot final: uma API, um worker e uma EC2 saudáveis; fila/DLQ vazias, sem bloqueios temporários. Oito negativos HTTP aprovados. A triagem dos sete HIGH e o runbook foram documentados; não significam eliminação das limitações de segurança.

## Reconstrução funcional em São Paulo

A etapa automática criou recursos novos e passou na jornada com Luna real e nos oito negativos HTTP. O estado remoto não contém os valores de segredos comparados. O repositório Git local registra o checkpoint entregue. A ausência de dependência runtime de Ohio foi conferida por configuração, endpoints e execução regional; um ensaio completo de destruição/recriação já foi autorizado, mas ainda não foi executado. Não transferir os testes de Ohio para esta região.
