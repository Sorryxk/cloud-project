# Etapa automática: São Paulo

> Corte histórico da implantação de 18/11, anterior à migração Bedrock. Em 19/11, o usuário reiterou a autorização para recriar somente São Paulo. Execução ainda pendente de login administrativo; não houve exclusão.

Este relatório preserva a implantação funcional de 18/11/2026, anterior à migração Bedrock e ao ciclo de recriação. Origem: http://periferia-sp-2059630122.sa-east-1.elb.amazonaws.com. O ambiente manual de Ohio permanece ligado e separado.

## O que foi criado

Terraform criou uma VPC nova (`vpc-0403ac250316eefc6`), sub-redes públicas, privadas e isoladas em `sa-east-1a`/`sa-east-1b`, duas NAT, rotas, endpoint S3, ALB, RDS, ECR, SQS/DLQ, IAM, ECS/EC2, autoscaling, logs, dashboard, alarmes e Budget. O bootstrap separado criou o bucket de estado. Não houve import de recursos de Ohio.

A AMI `ami-0f457e8ca4ca945e6bc92fd9e51647e0a` veio do parâmetro público regional do ECS. O PostgreSQL foi resolvido pela AWS para **17.9 em São Paulo**, em vez de reutilizar o endpoint ou a versão minor observada em Ohio. O banco é privado, criptografado, Single-AZ e tem backup de sete dias. As zonas são descobertas pela API regional; não são copiadas como IDs de outra região.

A imagem foi construída a partir do código e publicada em `920358117159.dkr.ecr.sa-east-1.amazonaws.com/periferia-sp/app`. O manifesto amd64 é `sha256:a32c04015bc9e9dad13042b55610d31ced712b51e7221168ab67c18852f474c8`. Ele coincide com o manifesto amd64 da construção manual porque os artefatos são iguais; o serviço usa o **repositório de São Paulo**, sem buscar a imagem no ECR de Ohio.

## Ordem automática e segredos

`scripts/deploy-terraform.py` cria o estado remoto, aplica a infraestrutura com aplicação parada, disponibiliza a capacidade após associar o Capacity Provider, publica a imagem, configura segredos regionais, executa migration/seed/grants e ativa os serviços. O seed não redefine produtos já existentes. O diretório operacional é isolado por conta/região/nome; os tfvars ficam fora do código, e o estado remoto do destino prevalece sobre sobras locais. Um digest reutilizado precisa existir no ECR regional.

Na execução inicial, a credencial OpenAI já fornecida pelo usuário foi copiada em memória para um segredo novo de São Paulo. Esse é um insumo externo da aplicação, não uma dependência de execução da infraestrutura de Ohio. O programa também aceita `OPENAI_API_KEY`; não exige um ARN de Ohio. As tasks acessam somente referências regionais. Os valores de senhas/chave não passam por variáveis Terraform, secret_version, arquivos de plano ou logs. O token temporário do ECR usa configuração Docker privada e é removido após a publicação.

O state principal está no S3 em São Paulo, com versionamento, criptografia, bloqueio público e lock nativo. Uma comparação em memória de quatro segredos — seis valores sensíveis — não encontrou valores literais nos estados principal e bootstrap. Também não foram encontrados literais de Ohio nesses estados. Isso complementa a inspeção das referências de runtime; uma busca textual isolada não provaria independência regional.

## Validações executadas

| Verificação | Resultado e evidência |
| --- | --- |
| Jornada com Luna real | Nove passos; proposta de R$ 149,90, contraproposta de R$ 145,41 após pedido de 20%, tentativa de 90% sem confirmar reserva, confirmação idempotente e cancelamento. `real-journey.json` |
| Prazo e estoque | Reserva manteve aproximadamente 900 segundos de validade; a fixture foi cancelada. O teste não repetiu a expiração completa de Ohio. |
| Guardrails HTTP | Oito negativos aprovados; cinco invariantes de carrinho/reservas/disponibilidade preservados. `guardrails-http.json` |
| Banco e IAM efetivos | API/worker usam papéis PostgreSQL distintos, TLS verdadeiro e 12 produtos. Atualização de preço negada para ambos. `api-runtime-smoke.json` e `runtime-smoke.json` |
| Hardening efetivo | IMDS bloqueado; CapEff e CapBnd iguais a zero; NoNewPrivs igual a 1 nos dois processos. Não elimina os achados da imagem. |
| Interface | Adição ao carrinho e aumento de quantidade conferidos no navegador, sem Failed to fetch. `loja-carrinho.png` |
| Configuração final | Uma API, um worker e uma EC2; serviços saudáveis, filas vazias, 18 alarmes operacionais. `final-snapshot.json` |
| Idempotência Terraform | Plano final com **No changes**. A diferença de campos vazios retornados pelo ECS foi corrigida explicitamente, sem ignorar container_definitions. `terraform-noop.txt` |
| Estado e credenciais | Valores comparados somente em memória; nenhum literal encontrado nos dois states. `state-security-audit.json` |

Os arquivos citados ficam em `evidence/terraform-sp-20261118/`. A fonte é `infra/terraform/`, com provider fixado pelo lockfile. As evidências de carga/resiliência de Ohio continuam identificadas como testes da primeira etapa; não foram transferidas automaticamente para São Paulo.

## Riscos e limites

O scan regional atual reporta **6 HIGH, 8 MEDIUM e 4 LOW**. O digest é o mesmo da análise anterior de sete HIGH: CVE-2026-76844 deixou de ser reportado na avaliação regional mais recente. Isso **não comprova correção de pacote**, pois os bytes da imagem não mudaram. A triagem anterior continua em `triagem-imagem.md`, com seu corte temporal.

HTTP público, RDS Single-AZ e mínimo de uma réplica permanecem limitações explícitas. Não há assinante externo do SNS. A infraestrutura tem proteção contra exclusão e não há rotina de desligamento. Os dois ambientes somam custos; Budget não é limite rígido de cobrança.

## Destruição e reconstrução: autorizadas, execução pendente

Foi produzido um plano real de destruição com **102 recursos gerenciados** do ambiente `periferia-sp`, sem executar exclusões. O bucket de estado está em bootstrap separado e não faz parte desse plano; Ohio também está fora. O resumo está em `evidence/terraform-sp-20261118/destroy-review.json`.

A autorização explícita foi recebida. Antes da remoção, Terraform deve desativar as proteções de exclusão do ALB/RDS e habilitar `allow_image_deletion` para o ECR deste ambiente. Há snapshot final obrigatório do RDS e recuperação de segredos por sete dias. Depois da remoção autorizada, a reconstrução deve usar novamente o código, com Bedrock e IAM, sem chave OpenAI, e repetir saúde/jornada/no-op. Um plano de destruição sozinho não comprova esse critério da rubrica.

Situação comprovada: criação funcional, parâmetros regionais, estado remoto, segredos externos e idempotência. Criação/destruição reproduzível e ausência de dependências ocultas durante uma reconstrução completa ainda precisam do ensaio autorizado; não atribuir A+ a essa dimensão apenas pela presença dos arquivos Terraform.
