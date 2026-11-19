# Avaliação independente da etapa automática

Revisão de **18/11/2026**, com leitura do PDF original, do código entregue e das evidências de `docs/evidence/terraform-sp-20261118/`. O corte inclui o snapshot de São Paulo das **16:01:23 UTC**, a auditoria do estado e o checkpoint de código informado abaixo. Este avaliador não alterou infraestrutura, não executou comandos AWS/Terraform, não leu o diretório operacional privado nem valores de segredos.

> Nota de corte: este parecer registra a implantação funcional **anterior ao ensaio de destruição/recriação**. A autorização posterior para executar esse ciclo não equivale à sua conclusão; as novas evidências serão avaliadas após o fechamento.

## Parecer

**A dimensão 7 — Terraform e portabilidade regional — alcança B comprovado.** O ambiente funcional foi criado em São Paulo, possui estado principal remoto e código parametrizado, publica a imagem no ECR regional e executa a jornada com Luna real sem depender dos recursos de runtime de Ohio.

**A ainda depende de demonstrar o ciclo real de destruição e recriação reproduzíveis. A+ não está comprovado.** Há apenas um plano de destruição revisado para 102 recursos; ele não executou exclusões nem demonstra que as proteções e a recriação funcionam até o fim. A ausência de autorização para destruir foi respeitada e não é um defeito do código; é uma evidência ainda pendente para os níveis superiores.

Esta avaliação é específica da dimensão 7. Não calcula uma nota global nem transfere automaticamente os resultados de carga/resiliência de Ohio para São Paulo. O PDF não fornece pesos ou fórmula de agregação.

## Confronto com a rubrica

| Nível | Situação | Fundamentação |
| --- | --- | --- |
| C | Superado | O Terraform cobre a infraestrutura da aplicação, não apenas alguns componentes. A execução funcional e os testes vão além de uma configuração parcial. |
| B | **Comprovado** | Ambiente completo em `sa-east-1`, estado principal remoto, módulo parametrizado, recursos regionais novos e jornada real. A imagem é publicada e executada no ECR de São Paulo. |
| A | **Parcial, ainda não comprovado integralmente** | AMI, AZs, imagens e endpoints regionais estão corretamente resolvidos e usados. A criação foi observada; a destruição/recriação ainda não foi executada. Um plano sem mudanças e um plano de destroy não substituem esse ciclo. |
| A+ | **Não comprovado** | Organização/reutilização e ausência de referências fixas de Ohio oferecem boa base. Como os níveis são cumulativos, a lacuna de A permanece. Também falta a prova de uma reconstrução limpa, com o contrato de bootstrap e suas limitações explicitados. |

## Código e cobertura conferidos

- **Parametrização e módulo:** [main.tf:1](../infra/terraform/main.tf) instancia `modules/platform` com região, nome, CIDR, digest e controles de ativação/proteção. [variables.tf:1](../infra/terraform/variables.tf) define os parâmetros; o provider usa a região recebida em [versions.tf:12](../infra/terraform/versions.tf). Versões de Terraform/provider são limitadas e o provider possui lockfile.
- **Rede completa:** [network.tf:1](../infra/terraform/modules/platform/network.tf) cria VPC, sub-redes em duas AZs, IGW, duas NAT, rotas, endpoint S3, SGs, ALB, target group e listener. Não reutiliza IDs da VPC manual.
- **Capacidade e serviços:** [ecs.tf:9](../infra/terraform/modules/platform/ecs.tf), [ecs.tf:42](../infra/terraform/modules/platform/ecs.tf) e [scaling.tf:1](../infra/terraform/modules/platform/scaling.tf) criam Launch Template, ASG, Capacity Provider e sua associação. [ecs.tf:89](../infra/terraform/modules/platform/ecs.tf) e [ecs.tf:126](../infra/terraform/modules/platform/ecs.tf) definem tarefas/serviços EC2, health checks, distribuição e circuit breaker. As políticas API/worker estão em [scaling.tf:25](../infra/terraform/modules/platform/scaling.tf).
- **Persistência, mensageria e imagem:** [data.tf:8](../infra/terraform/modules/platform/data.tf) cria RDS privado/criptografado e senha master gerenciada. [data.tf:32](../infra/terraform/modules/platform/data.tf) cria metadados dos segredos; [data.tf:39](../infra/terraform/modules/platform/data.tf) cria filas, DLQ e redrive; [data.tf:56](../infra/terraform/modules/platform/data.tf) cria ECR regional imutável.
- **IAM e observabilidade:** [iam.tf:22](../infra/terraform/modules/platform/iam.tf) separa execution roles, task roles e acessos aos segredos; [iam.tf:46](../infra/terraform/modules/platform/iam.tf) limita o worker à própria fila. [observability.tf:1](../infra/terraform/modules/platform/observability.tf) cobre logs, SNS, 18 alarmes, orçamento e dashboard regional.

O código está versionado no repositório Git local, branch `main`, com primeiro checkpoint **`afb8cf87f8bbfad024a7b2fad50d89a075b40b65`**, conferido pelo histórico do Terraform e de seu deployer. [source-version.json](evidence/source-version.json) registra esse checkpoint. Não há remoto/publicação nem histórico anterior a esse primeiro commit; um lockfile de dependências, isoladamente, não comprovaria versionamento do código.

## Contrato de implantação e estado remoto

A entrega funcional utiliza **Terraform mais o deployer operacional entregue**, não um único `terraform apply` com os valores padrão. [deploy-terraform.py:124](../scripts/deploy-terraform.py) prepara o backend; [deploy-terraform.py:170](../scripts/deploy-terraform.py) aplica a infraestrutura; [deploy-terraform.py:178](../scripts/deploy-terraform.py) publica a imagem regional; [deploy-terraform.py:197](../scripts/deploy-terraform.py) configura valores de segredos em memória; [deploy-terraform.py:217](../scripts/deploy-terraform.py) executa migration/seed/grants e depois ativa os serviços.

Terraform gerencia os recursos da infraestrutura; publicação de artefato, valores de credenciais e inicialização de dados são operações de aplicação automatizadas pelo script. Credenciais AWS temporárias, Docker/buildx, Terraform e uma credencial válida do provedor de IA são pré-requisitos documentados, não recursos de Ohio importados. O script valida planos salvos antes de aplicá-los em [deploy-terraform.py:97](../scripts/deploy-terraform.py).

O estado principal usa backend S3 em [versions.tf:9](../infra/terraform/versions.tf), com `use_lockfile=true` fornecido pelo bootstrap. O bucket tem versionamento, criptografia AES256, bloqueio público, política TLS e proteção contra exclusão em [state/main.tf:22](../infra/terraform/state/main.tf). A [auditoria do estado](evidence/terraform-sp-20261118/state-security-audit.json) confirma essas configurações e comparação em memória de **quatro segredos/seis valores**, sem encontrar os valores nos dois estados examinados. Isso não é atestação de todo log, versão histórica ou segredo possível.

**Limitação do bootstrap:** o estado que cria o próprio bucket é aplicado localmente em diretório privado e copiado para S3; essa cópia não tem a mesma coordenação concorrente do backend principal. O script recupera o checkpoint remoto em [deploy-terraform.py:133](../scripts/deploy-terraform.py), e o [README:30](../infra/terraform/README.md) exige um bootstrap por vez. O estado principal da aplicação é efetivamente remoto e tem locking; não generalizar essa propriedade para a etapa inicial do bucket.

## Portabilidade e independência de Ohio

| Dependência | Código e prova |
| --- | --- |
| AMI e AZs | [variables.tf:15](../infra/terraform/modules/platform/variables.tf) consulta AZs disponíveis e o parâmetro público SSM na região do provider. O deployment registra `sa-east-1a/b` e AMI `ami-0f457e8ca4ca02c88`, não a AMI de Ohio. |
| Imagem | O deployer constrói Linux/amd64 do código local e publica no ECR retornado pelo módulo, em [deploy-terraform.py:178](../scripts/deploy-terraform.py). A tarefa usa URL regional por digest em [variables.tf:21](../infra/terraform/modules/platform/variables.tf). |
| Dados e endpoints | [ecs.tf:70](../infra/terraform/modules/platform/ecs.tf) recebe região, DB, fila, origem ALB e referências dos segredos recém-criados. Os runtime smokes confirmam banco/fila regionais, TLS e papéis distintos. |
| IAM | Papéis recebem o nome do ambiente e as políticas apontam para recursos do módulo. Como IAM é global na conta, instalações simultâneas precisam de nomes distintos, conforme o README; não se importa o papel manual de Ohio. |
| Chave OpenAI | `OPENAI_API_KEY` pode suprir a primeira configuração. A opção `--openai-key-source` em [deploy-terraform.py:205](../scripts/deploy-terraform.py) é uma cópia inicial opcional, com região derivada do ARN fornecido. As tasks referenciam o segredo novo em São Paulo; não consultam a origem para atender clientes. |

A busca estática nos arquivos Terraform/deployer não encontrou IDs/ARNs de Ohio fixados. A auditoria dos estados também não encontrou literais de Ohio. Junto dos endpoints e testes regionais, isso sustenta a independência observada. Busca por literais, isoladamente, não provaria ausência de dependências ocultas; uma recriação limpa usando a chave por meio independente de Ohio fortalecerá a prova para A/A+.

Fornecer uma credencial externa válida de IA é um pré-requisito da aplicação. Copiá-la opcionalmente de um segredo existente não transforma o ambiente em consumidor do banco, cluster, ECR ou infraestrutura de runtime de Ohio.

## Execução funcional comprovada em São Paulo

A [implantação](evidence/terraform-sp-20261118/deployment.json) registra VPC nova `10.52.0.0/16`, ECR/cluster/RDS/ALB em `sa-east-1`. O [snapshot final](evidence/terraform-sp-20261118/final-snapshot.json) registra API **1/1**, worker **1/1**, implantações COMPLETED, **uma EC2 privada saudável**, ALB saudável, **18 alarmes** e fila/DLQ vazias. RDS está disponível, privado, criptografado, com backup de sete dias; a versão observada é **17.9**, enquanto o código pede a família 17, sem fixar o minor de Ohio.

A [jornada Luna real](evidence/terraform-sp-20261118/real-journey.json) concluiu nove passos: proposta, negociação, tentativa adversarial, confirmação repetida com a mesma reserva e cancelamento. [guardrails-http.json](evidence/terraform-sp-20261118/guardrails-http.json) registra **8/8 negativos aprovados e cinco invariantes preservadas**.

Os testes de runtime da [API](evidence/terraform-sp-20261118/api-runtime-smoke.json) e do [worker](evidence/terraform-sp-20261118/runtime-smoke.json) registram TLS, 12 produtos, papéis PostgreSQL próprios, atualização de preço negada, IMDS bloqueado, `CapEff=0`, `CapBnd=0` e `NoNewPrivs=1`. [worker-queue-iam.json](evidence/terraform-sp-20261118/worker-queue-iam.json) confirma acesso à própria fila e recusa 403 na DLQ. O hardening é definido em [ecs.tf:108](../infra/terraform/modules/platform/ecs.tf) e foi observado no processo, não apenas configurado.

O [novo plan](evidence/terraform-sp-20261118/terraform-noop.txt) terminou sem diferenças e liberou o lock. Isso comprova convergência da configuração naquele corte, não a reprodução de um ambiente destruído nem tolerância a todas as falhas. Políticas regionais configuradas não substituem novos ensaios de escala/resiliência em São Paulo quando essas propriedades forem alegadas para a região.

## O que falta para demonstrar A e sustentar A+

O [destroy-review.json](evidence/terraform-sp-20261118/destroy-review.json) identifica **102 deleções planejadas**, conta/região corretas, Ohio e bucket do backend fora do escopo e `executionAuthorized=false`. Não é log de execução. [network.tf:139](../infra/terraform/modules/platform/network.tf) protege o ALB; [data.tf:25](../infra/terraform/modules/platform/data.tf) protege o RDS e exige snapshot final; [data.tf:59](../infra/terraform/modules/platform/data.tf) impede excluir ECR não vazio sem opção explícita. O bucket tem `prevent_destroy`. Essas barreiras tornam importante executar o ciclo autorizado, em vez de assumir que o plano conseguirá concluí-lo.

O ensaio que falta deve registrar:

1. **Autorização e revisão do destino:** plano salvo referente apenas a São Paulo, tratamento deliberado das proteções e definição dos artefatos preservados. Não executar exclusões por causa deste parecer.
2. **Destruição real pelo fluxo entregue:** log/resultado, estado principal sem os recursos gerenciados da aplicação e verificação de que Ohio permaneceu intacto. Bucket/checkpoint, snapshot final e recuperação dos segredos por sete dias são retenções intencionais; devem ser inventariadas, não tratadas como remoção sem qualquer vestígio.
3. **Recriação a partir do código versionado:** usar parâmetros e credenciais documentados, recuperar somente o backend previsto e reconstruir a imagem regional sem IDs antigos, imports corretivos ou reparos manuais não previstos. O uso de um diretório operacional novo fortalece a prova de que não existe uma dependência de arquivos privados do primeiro deploy.
4. **Nova validação funcional:** AMI/AZs/IDs/digest corretos, estado remoto/segredos, bootstrap, serviços saudáveis, jornada Luna, idempotência/cancelamento, guardrails e plan sem mudanças. A criação de novos IDs é esperada; o requisito é reproduzir a solução funcional, não manter os mesmos identificadores.
5. **Fechamento de reprodutibilidade:** preservar versões/configuração, resultados e tratamento das retenções. Após esse ciclo, avaliar A. Para A+, acrescentar evidência forte de ausência de dependências ocultas, recuperação a partir do estado remoto e qualidade/reutilização do código; o locking concorrente do bootstrap continua uma limitação documentada.

## Limitações que Terraform não remove

O serviço público permanece HTTP, o mínimo de uma réplica continua limitado em falha abrupta e o RDS é Single-AZ. Os alertas possuem SNS sem destinatário externo. Esses pontos pertencem à segurança, disponibilidade e operação; provisioná-los por código não os transforma automaticamente em propriedades de nível A+.

O [scan atual](evidence/terraform-sp-20261118/image-scan.json) informa **6 HIGH, 8 MEDIUM e 4 LOW**. Ele examina o mesmo manifesto `sha256:a32c04015bc9e9dad13042b55610d31ced712b51e7221168ab67c18852f474c8` do [scan anterior](evidence/manual-validation-20261118/ecr-v3-scan-by-digest.json), que reportava sete HIGH. `CVE-2026-76844` deixou de aparecer; **não houve patch da imagem demonstrado por essa redução**. A mudança é no resultado da varredura, e não prova correção do pacote ou risco zero. Os controles efetivos de capabilities/no-new-privileges reduzem exposição, sem apagar os achados residuais.

A etapa automática já tem funcionamento regional e nível B comprovados. A entrega dos níveis superiores depende agora da evidência de destruição/recriação e das ressalvas explicitadas, não de criar mais serviços ou de acrescentar CI/CD, que o PDF não exige.

Revisão de português concluída. Apenas este parecer e a nota introdutória de referência no relatório manual foram atualizados por este avaliador.
