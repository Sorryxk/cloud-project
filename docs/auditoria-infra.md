# Auditoria independente da infraestrutura

Revisão em 16/11/2026, para a etapa manual de Ohio (`us-east-2`), sem atribuição de conceito global. Fonte normativa: `Projeto_Semestral_Computacao_em_Nuvem.pdf`, especialmente páginas 2, 3, 5 e 6. A segunda etapa, com Terraform em São Paulo, ainda não é uma entrega concluída.

## Método e limites

Foram examinados as definições concretas de tarefas, serviços, políticas, Launch Template, métricas e alarmes; o inventário; os históricos de escala e as evidências produzidas pela execução principal. Não foram acessados valores de segredos nem realizadas alterações na AWS, no código ou nos dados.

As consultas independentes `describe-services`, `describe-security-groups` e `describe-db-instances` falharam por impossibilidade de conexão aos endpoints a partir deste agente. Isso limita a atualização independente do estado, mas **não demonstra falha dos serviços AWS**. As conclusões operacionais abaixo se apoiam nas respostas AWS já salvas pelo executor. Onde existe somente configuração, ela é identificada como configuração, não como teste concluído.

A execução principal continua os ensaios de falha. Durante estes ensaios, o mínimo da API e do ASG foi temporariamente elevado para 2; o mínimo operacional acordado com o usuário é 1. Este relatório não deve congelar estados transitórios como configuração final.

## Evidências consolidadas

| Item do roteiro | Evidência examinada | Conclusão desta revisão |
| --- | --- | --- |
| ECS sobre EC2, sem Fargate principal | `infra/aws/task-api-ohio.json:3`, `infra/aws/task-worker-ohio.json`, inventário e snapshots ECS/ASG | Configuração EC2 explícita e execução registrada nas evidências. |
| ECR regional e imagem Docker | `infra/aws/task-api-ohio.json:16`, `docs/aws-inventory.json`, `docs/evidence/ecr-image-scan.json` | Imagem por digest no ECR de Ohio; a presença da imagem e a varredura têm evidência operacional. |
| ASG e Capacity Provider | `docs/aws-inventory.json`, campos `capacity_provider` e `auto_scaling_group`; `docs/evidence/aws-ec2-scaling-activities.json` | Associação e managed scaling/draining/proteção de término registrados. Inclusão automática de duas EC2 às 13:12 UTC comprovada; quantidade desejada passou de 1 para 3. |
| Dois níveis de elasticidade | `docs/evidence/aws-api-scaling-activities.json` e `aws-ec2-scaling-activities.json` | API passou de 1 para 3, depois 2 e 1; EC2 passou de 1 para 3. Não é apenas uma política configurada. |
| Serviços com responsabilidades e perfis distintos | `task-api-ohio.json`, `task-worker-ohio.json`, `scaling-api-ohio.json`, `scaling-worker-ohio.json` | Atendimento por requisições/alvo e worker por backlog/task. A escala efetiva do worker ainda precisa de evidência própria. |
| Rede própria, duas AZs, privadas e ALB | Inventário de VPC/sub-redes/rotas, snapshots com hosts nas AZs a/b e alvos do ALB; `docs/aws-manual.md` | Topologia documentada e recursos identificados. Esta revisão não conseguiu repetir a leitura online dos SGs/rotas; não trata a documentação isolada como comprovação completa de todas as regras atuais. |
| Portas e posicionamento | `task-api-ohio.json:25`, `service-api-ohio.json:20` | Bridge, hostPort dinâmico, spread por AZ e instância. Worker sem publicação de porta. O isolamento por SG é por host, não por serviço; os controles complementares são IAM e papéis SQL. |
| Reservas/limites e dimensão do host | `task-api-ohio.json:18`, tarefa worker, `ecs-user-data.sh:7`, evidência de recursos ECS descrita no estado | CPU 256 e reserva/limite de memória 512 MiB por task; 256 MiB reservados para o host. Com 1.657 MiB registrados no host, cabem três tasks por memória. Dez tasks máximas exigem ao menos quatro hosts, antes de considerar falhas ou transientes de substituição. Não há prova de carga sustentada no máximo de dez tasks. |
| Health checks e substituição | `task-api-ohio.json:80`, `service-api-ohio.json:12`, histórico `task_failure_test` e `docs/evidence/aws-availability-probe.json` | Liveness/readiness, circuit breaker e substituição estão configurados. O ensaio está em curso; é necessário usar a evidência final para concluir sobre continuidade e recuperação. |
| Persistência externa | Inventário RDS, `docs/evidence/aws-worker-verification.json` e jornada real | RDS privado Single-AZ; smoke test do worker confirmou 12 produtos, papel restrito, TLS validado e readiness 200. Jornada comercial está persistida. |
| Segredos e IAM separados | `task-api-ohio.json:70`, `infra/aws/policies/execution-api.json`, `execution-worker.json`, `execution-bootstrap.json`, `worker-task.json:6` | As tarefas referenciam segredos, sem valores nos templates. Execution roles separadas, worker com ações SQS limitadas à fila principal, API sem necessidade de administrar AWS. Permissões efetivas atuais não foram relidas online nesta revisão. |
| Privilégios de banco | `infra/aws/database-roles.sql:7` e inventário `db_negative_verification` | API só atualiza `reserved` no produto. Worker não recebe acesso a sessões nem alteração de preço. O teste remoto salvo confirmou que o worker não pôde alterar preço ou ler sessões. |
| Proteção de credenciais da EC2 | `infra/aws/launch-template.json`, `ecs-user-data.sh:17`, `aws-worker-verification.json` | IMDSv2/hop limit 1 e bloqueio de IMDS por iptables configurados. O teste salvo confirmou regra presente e acesso bloqueado dentro do container. |
| Comunicação assíncrona e DLQ | Evidências `aws-dlq-retries.json`, `aws-dlq-message.json`, `aws-dlq-alarm.json`, `aws-dlq-alarm-action.json` | Cinco falhas de processamento, encaminhamento à DLQ, alarme `ALARM` e publicação SNS comprovados. O recebimento de inspeção na DLQ elevou a contagem total para seis; não deve ser descrito como sexta tentativa do worker na fila principal. |
| Logs, métricas e alarmes | Configuração awslogs nas tarefas, `src/server/telemetry.ts:17`, `infra/aws/dashboard-ohio.json`, arquivos `alarm-*`, evidências DLQ/SNS | Há logs JSON, contexto de requisição, EMF de negócio, painel e alarmes técnicos. Retenção de 30 dias está registrada pelo executor; esta revisão não conseguiu consultar online os grupos para confirmar novamente. |

## Riscos e lacunas que afetam a avaliação

1. **Disponibilidade com mínimo 1 é limitada.** `minimumHealthyPercent:100` e `maximumPercent:200` favorecem atualização planejada com uma substituta saudável (`service-api-ohio.json:17`). Isso não garante ausência de interrupção quando a única task ou EC2 sofre perda abrupta. A prova com duas réplicas em hosts distintos deve ser apresentada com essa condição explícita. RDS Single-AZ também permanece um ponto único de indisponibilidade; não há evidência de failover multi-AZ e ele não deve ser alegado.

2. **A carga inicial teve falhas ainda sem diagnóstico conclusivo.** `docs/evidence/aws-load-catalog-50.json` registra 2.712 respostas 200 e 24 falhas de rede, p95 de aproximadamente 660 ms e p99 de 5,34 s. São 2.736 tentativas contabilizadas, com cerca de 0,88% de falhas. O campo `requests` contém apenas as 2.712 respostas, portanto não é o total das tentativas. A duração observada foi de 585,091 s, não os 360 s planejados. O ensaio coincidiu com atualizações das tasks; essa coincidência **não comprova a causa** dos erros. Repetir com configuração estável e registrar `error.name`, código da causa e horário antes de concluir sobre estabilidade. A medição cobre catálogo, não IA ou confirmação comercial sob carga.

3. **A varredura da imagem não está limpa.** `ecr-image-scan.json` registra sete achados HIGH, quatro MEDIUM, quatro LOW e um UNDEFINED. Os detalhes estão em `ecr-high-findings.json`. O executor informou que a simulação de upgrade não encontrou pacotes atualizáveis. Isso não encerra a análise: é necessário avaliar aplicabilidade, mitigação e alternativas de base. Não foi demonstrada exploração pela aplicação, e contagem de CVEs não prova, isoladamente, que cada vetor é alcançável. Execução sem root e filesystem somente leitura nas tasks reduzem exposição, sem eliminar os achados.

4. **HTTP não protege a sessão em trânsito.** `task-api-ohio.json:63` define origem HTTP; `src/server/main.ts:36` condiciona as proteções de transporte a `COOKIE_SECURE`. O PDF não exige domínio próprio ou certificado ACM nominalmente, mas tráfego de sessão sem TLS continua sendo uma limitação real para a dimensão de proteção de dados. Dados fictícios reduzem o impacto, sem transformar HTTP em transporte seguro.

5. **Alarmes de tasks detectam queda total, não insuficiência relativa.** `alarm-periferia-api-sem-tasks.json:20` usa `RunningTaskCount < 1`; o worker usa o mesmo desenho. Com desejado 2 ou 3, perder uma réplica não dispara esse alarme. Um alarme sustentado de `DesiredTaskCount - RunningTaskCount > 0` tornaria a cobertura operacional mais completa. O limiar fixo não significa que inexista monitoramento básico de saúde.

6. **Publicação SNS não é notificação externa entregue.** O histórico comprova ação SNS bem-sucedida. Sem assinatura externa, não há evidência de recebimento por e-mail ou por um responsável. Não foi solicitado nem realizado envio a terceiros por esta auditoria.

7. **Escala de entrada e falha de EC2 precisam da evidência final.** A configuração de managed draining e proteção de término não substitui comprovar remoção com drenagem, reposição após perda de host e dados preservados. O histórico de inclusão já é suficiente para comprovar subida de capacidade; a demonstração completa do ciclo ainda depende dos ensaios conduzidos pelo executor.

8. **O orçamento não é um bloqueio de cobrança.** A base de preços consultada pelo executor é aproximadamente US$ 0,1693/h antes de armazenamento, tráfego, métricas e expansão: em 730 horas, cerca de US$ 123,59 somente nessa base. Mínimo 1 não torna NAT/ALB gratuitos. O usuário autorizou manter o ambiente ligado; essa decisão deve ser documentada sem afirmar garantia mensal dentro de US$ 100.

9. **Há documentação histórica que pode induzir erro.** `infra/aws/service-api-ohio.json:5` ainda contém desejado 0 porque registra a criação anterior à chave, enquanto o serviço real já foi ativado. `docs/estado.md` e partes da matriz ainda descrevem a chave como pendente. Não usar esses trechos como estado operacional corrente. Preservar a entrada histórica com identificação clara e acrescentar uma configuração/consulta final atualizada.

10. **Observabilidade pode melhorar o diagnóstico.** O worker registra `worker.loop_failed` sem classificação da exceção (`src/server/worker.ts:125`), o que torna difícil separar erros de IAM, rede, SQL e dependência. Campos sanitizados de tipo/código/status, sem mensagem sensível ou credenciais, ajudariam a resposta a incidentes. Já há IDs correlacionáveis e métricas; não se trata de ausência completa de observabilidade.

## Evidências finais a solicitar ao executor e ao avaliador

- Snapshot atualizado de serviços, tasks/hosts/AZs, ALB, ASG e políticas, após retornar aos mínimos operacionais acordados.
- Resultado final do monitor de disponibilidade ao parar task e perder EC2, incluindo erros e persistência da reserva/conversa.
- Reposição da EC2 e remoção com drenagem; não misturar substituição por deploy com falha abrupta.
- Escala independente do worker e teste real de duplicidade, outbox e expiração, se ainda pendentes ao fechar a avaliação.
- Repetição da carga estável e explicação baseada em dados para as falhas observadas.
- Inventário/documentação final coerentes, com data e limites claramente identificados.
- A etapa Terraform/São Paulo deve ser avaliada separadamente como futura/não entregue, sem penalizar como falha de execução da etapa manual, mas sem declarar o projeto semestral inteiro concluído.

Este relatório fornece evidências e limitações ao avaliador posterior. Não atribui nota, não certifica segurança e não transforma uma configuração em uma demonstração concluída.

## Atualização posterior à auditoria

O relatório acima preserva o corte e as conclusões do auditor. A coleta posterior e as correções implantadas constam em `estado.md` e `avaliacao-rubrica.md`. A v3 foi implantada nas task definitions revisão 2; a repetição de carga teve 2.400 respostas HTTP 200 sem falhas. Esta atualização documental do executor não altera retroativamente os achados da auditoria.
