# Reavaliação independente pela rubrica

Revisão encerrada em **18/11/2026**, após os ensaios adicionais e o snapshot final das **13:27 UTC**. Os horários técnicos deste relatório são UTC. A avaliação anterior, de 16/11, estimava B porque ainda faltavam provas de drenagem ocupada, escala do worker e recuperação efetiva da outbox.

> Atualização posterior ao corte manual de 18/11 às 13:27 UTC: São Paulo foi implantado com Terraform e recebeu [parecer próprio da etapa automática](avaliacao-terraform.md), com B comprovado na dimensão 7 e destruição/recriação ainda não executadas. As referências abaixo à etapa automática pendente descrevem o corte histórico desta avaliação manual.

## Parecer

**A estimativa técnica da etapa manual evoluiu para A, com ressalvas. O ambiente está pronto para avançar à etapa automatizada. A+ global ainda não está sustentado.** As principais lacunas de demonstração da infraestrutura manual foram fechadas; segurança e operação permanecem em B, embora tenham recebido documentação e evidências adicionais.

Isso não equivale a declarar o projeto semestral completo: Terraform e o ambiente independente em São Paulo continuam pendentes. Também não é uma nota do professor. O PDF não define pesos nem fórmula de agregação dos sete conceitos; a estimativa A representa o nível predominante das evidências manuais, sem média inventada. Se a avaliação exigir A em todas as dimensões, a ressalva de segurança/operação impedirá esse resultado.

## Método e escopo

Foram relidas diretamente as sete páginas de `Projeto_Semestral_Computacao_em_Nuvem.pdf`, confrontando os requisitos das páginas 2–3 e a rubrica cumulativa das páginas 4–7 com as auditorias, o código e as evidências fechadas. Não foram alterados recursos AWS ou código, lidos segredos ou executada a suíte completa por este avaliador.

A primeira etapa permite console e AWS CLI em Ohio e proíbe Terraform/CloudFormation/CDK. A reconstrução integral em São Paulo é outra etapa. Configuração, teste local e execução AWS foram tratados separadamente. As conclusões se limitam às janelas e aos cenários observados; não constituem auditoria forense de toda a conta nem garantia de disponibilidade contínua.

## Conceito estimado por dimensão

| Dimensão | Estimativa | Evidência e limite |
| --- | --- | --- |
| 1. MVP e integração da aplicação | **A** | Luna real consulta o catálogo e persiste carrinho/proposta. Confirmação explícita/idempotente, estoque concorrente, cancelamento, expiração e recuperação da IA foram validados. As três correções da auditoria foram implantadas na v3 e a jornada real foi repetida. Os testes adversariais são relevantes, mas não demonstram ainda a abrangência e a rastreabilidade excepcionais de A+. |
| 2. Arquitetura e topologia de serviços | **A** | API e worker possuem responsabilidades, credenciais e políticas de escala distintas. Outbox/SQS e recuperação pelo PostgreSQL respondem ao prazo comercial e ao isolamento de falhas. A recusa de publicação não impediu a liberação do estoque; a posterior recuperação não o liberou novamente. Há fundamento concreto para a decomposição, sem depender da quantidade de serviços como argumento de qualidade. |
| 3. Rede, disponibilidade e balanceamento | **A na configuração ensaiada** | VPC própria em duas AZs, hosts privados, SGs restritivos, ALB e health checks estão comprovados. O novo ensaio começou antes da intervenção e manteve 1.761/1.761 consultas 200 durante drenagem de host ocupado, reposição e retirada. Esse conceito de continuidade se refere à manutenção com duas APIs e capacidade substituta; o mínimo econômico de uma réplica conserva sua limitação em falha abrupta. |
| 4. ECS sobre EC2 e gerenciamento de capacidade | **A** | Inclusão, utilização, drenagem ocupada, substituição e remoção foram demonstradas com Launch Template, Capacity Provider e limites de recursos. Houve proteção contra terminar hosts ocupados e posterior redução automática da frota. Para A+, a eficiência e a prevenção de insuficiência precisam de caracterização mais ampla dos máximos configurados e do regime sustentado de créditos/CPU. |
| 5. Elasticidade, mensageria e resiliência | **A+ nos cenários quantificados** | API e frota escalaram; o worker completou 1→4→3→2→1 por política. Duplicidade, DLQ e falha/reenvio da outbox têm provas reais. Métricas de negócio e análise de backlog, idade, consumo, latência e recuperação atendem ao critério quantitativo de A+ nesta dimensão. A conclusão é sobre os ensaios descritos, não sobre milhares de vendas distintas ou pico simultâneo de todos os componentes. |
| 6. Segurança, observabilidade e operação | **B**, com avanços em direção a A | Papéis separados, segredos externos, TLS PostgreSQL, controles de sessão, logs, métricas, alarmes e testes negativos estão presentes. Agora há runbook e triagem individual da imagem por digest. Entretanto, o cookie público ainda trafega por HTTP; os sete achados HIGH não foram corrigidos/removidos e parte da exposição local ainda não foi verificada. Logs genéricos e ausência de destinatário externo dos alertas também limitam a operação. |
| 7. Terraform e portabilidade regional | **Não avaliada nesta etapa; abaixo de C na entrega final atual** | Não há Terraform criando o ambiente completo em São Paulo, backend remoto ou demonstração de criação/destruição independente. Essa ausência não infringe a etapa manual, mas continua pendente para avaliar o projeto final. |

O A da dimensão 3 não significa que o perfil final com uma API e uma EC2 tenha a mesma tolerância a falha abrupta do perfil de demonstração. Uma atualização planejada e uma perda abrupta são eventos distintos. RDS Single-AZ permanece um ponto único de indisponibilidade; o PDF não obriga RDS Multi-AZ.

## Provas que fecharam as lacunas de 16/11

### Drenagem de host ocupado

O host `i-0a28009f621f5b91a` executava uma API e um worker quando foi colocado em DRAINING às **11:34:28 UTC**. A carga já estava ativa. Os snapshots registram substitutas saudáveis, as tasks originais em STOPPED com motivo de drenagem e a retirada somente após o esvaziamento do host. A remoção foi solicitada às 11:39:35 e concluída às 11:40:19 UTC.

Foram **1.761 consultas ao catálogo por dez visitantes, todas HTTP 200**, entre 11:33:21 e 11:40:23, com p95 de **630,6 ms**. A sonda independente preservou a reserva na janela. Isso fecha a lacuna de drenagem ocupada; não é apenas remoção de EC2 vazia.

Fontes: [drain-summary.json](evidence/manual-validation-20261118/drain-summary.json), [drain-load.json](evidence/manual-validation-20261118/drain-load.json) e [infra-snapshots.jsonl](evidence/manual-validation-20261118/infra-snapshots.jsonl). Os snapshots iniciam coletas sequenciais, não fotografias atômicas de todos os recursos; os horários dos eventos sustentam as transições.

### Escala independente e análise quantitativa do worker

A linha de base publicou 100 mensagens; a carga principal publicou **24.680 replays válidos**, sem falhas de publicação, em aproximadamente 365 segundos. Os corpos representam **12 eventIds em três reservas de teste já encerradas**. O banco confirmou 12 registros ProcessedEvent. Não são 24.680 vendas ou expirações comerciais diferentes.

| Sinal | Observação conferida | Interpretação |
| --- | --- | --- |
| Worker único, 11:40–11:43 | Média de 2.431 exclusões/minuto, aproximadamente 40,5/s | Taxa observada durante essas janelas de carga, não capacidade universal do serviço. |
| Quatro workers, minuto 11:45 | 8.003 exclusões/minuto, aproximadamente 133,4/s | Razão observada de 3,29 vezes; as janelas não formam um benchmark causal isolado. Contadores SQS são aproximados e não contam vendas únicas. |
| Backlog e idade | Maior média de 60 s: 6.671; sondagem aproximada: 9.571; idade máxima: 209 s | O alvo de dez mensagens por worker não foi mantido durante o pico. A política aumenta capacidade, mas não garante dez mensagens ou latência constante em todos os instantes. |
| CPU/memória do worker | Médias do serviço chegaram a 79,05% da CPU reservada e 17,72% da memória reservada | Não são percentuais da EC2 nem máximos de RSS de cada container. Há margem de memória no recorte, sem prova dos máximos simultâneos de todos os serviços. |
| Banco e créditos | CPU RDS até 13,48%, conexões até 15; há séries de crédito/CPU dos hosts | Esses sinais não indicam saturação sustentada no recorte. Um saldo próximo de zero isoladamente não prova throttling; faltam testes longos no máximo configurado para extrapolar. |

A política de backlog acionou a elevação para quatro workers às **11:44:06**; o snapshot iniciado às **11:44:25** já encontrou quatro executando. A elevação transitória de um para dois durante a drenagem não foi contada como autoscaling.

Após encerrar a publicação às 11:46:06, o histórico confirmou reduções automáticas **4→3 às 12:02:48, 3→2 às 12:08:48 e 2→1 às 12:14:48 UTC**, todas Successful e causadas pela política. O primeiro scale-in ocorreu cerca de 16 min 42 s após o produtor parar; o retorno a um worker levou 28 min 42 s. A redução lenta evita oscilação, mas mantém capacidade extra e seu custo potencial por mais tempo.

O Capacity Provider iniciou a redução **EC2 2→1 às 12:30:55**, concluída às **12:31:39 UTC**. Uma tentativa anterior foi cancelada pela proteção de scale-in. A retirada manual de 3→2 durante a manutenção foi mantida separada dessa redução automática.

Fontes: [worker-load-publication-summary.json](evidence/manual-validation-20261118/worker-load-publication-summary.json), [worker-replay-idempotency.json](evidence/manual-validation-20261118/worker-replay-idempotency.json), [final-worker-scaling.json](evidence/manual-validation-20261118/final-worker-scaling.json), [final-ec2-scaling.json](evidence/manual-validation-20261118/final-ec2-scaling.json), [recovery-metrics.json](evidence/manual-validation-20261118/recovery-metrics.json), [final-metrics.json](evidence/manual-validation-20261118/final-metrics.json) e [final-metric-queries.json](evidence/manual-validation-20261118/final-metric-queries.json).

### Falha efetiva e recuperação da outbox

A reserva venceu às **11:48:03.052 UTC**, preservando o prazo comercial real de aproximadamente 900 segundos. Antes do vencimento, uma recusa **HTTP 403** confirmou que a task role do worker não conseguia enviar. Duas tentativas reais falharam; a outbox permaneceu com `sentAt` nulo e tentativas crescentes.

A recuperação independente pelo banco gravou EXPIRED às **11:48:19.254**, atraso de **16,202 segundos**, e liberou o estoque para 20/reservado 0. Depois da restauração, a terceira tentativa enviou às **11:49:03.228**; houve um ProcessedEvent e nenhuma segunda liberação de estoque. A falha também produziu duas ocorrências de OutboxFailures; o novo alarme entrou em ALARM e executou a ação SNS.

Essa prova fecha o cenário que as tentativas de 16/11 não haviam comprovado. O pico de backlog foi observado antes; a fila já tinha leituras zero desde 11:46. **Não foi um ensaio de falha de publicação simultânea ao pico do backlog.** O alarme foi criado durante o ensaio e avaliou o ponto histórico de falha, portanto não demonstra detecção instantânea anterior à intervenção manual.

Fontes: [outbox-recovery-summary.json](evidence/manual-validation-20261118/outbox-recovery-summary.json), [outbox-failure-logs.json](evidence/manual-validation-20261118/outbox-failure-logs.json) e [outbox-alarm-history.json](evidence/manual-validation-20261118/outbox-alarm-history.json).

## MVP, guardrails e limites da estabilidade

As provas anteriores de Luna real, proposta persistida, confirmação idempotente, concorrência de estoque, cancelamento autorizado e expiração permanecem válidas. A v3 implantou as correções de contraproposta em todas as rodadas, recuperação por probe/lease e visibilidade de todas as reservas ativas. Os **11 testes focados** passaram; a jornada real v3 foi repetida com cancelamento.

O teste HTTP adicional aprovou **8/8 negativos**, mantendo os carrinhos, reservas e disponibilidade pública inalterados. Ele não exercitou jailbreak generativo, esgotamento de rate limit nem acesso a uma reserva existente de outra sessão; estes não devem ser inferidos daquele arquivo.

A repetição anterior de 50 visitantes ao catálogo teve **2.400 respostas 200 e zero erros**, p95 de 476 ms, sem novo deployment simultâneo. A primeira janela teve 24 erros de rede em 2.736 tentativas. A repetição melhora a evidência, sem provar retrospectivamente a causa das falhas anteriores, e não mede IA ou confirmação comercial com 50 usuários.

Na sonda longa de 18/11, foram **1.007 HTTP 200 em 1.011 tentativas**. Houve dois TimeoutError e dois ENOTFOUND entre 12:12:48 e 12:13:01, depois de uma lacuna local de aproximadamente 15 minutos; consultas voltaram a 200. Pausas também produziram assinaturas AWS expiradas. Esses indícios não isolam a causa dos erros HTTP e não comprovam falha AWS. O resultado 1.761/1.761 da drenagem pertence a outra janela/carga; não pode ser usado para apagar os quatro erros da sonda longa.

Fontes: [aws-real-journey-v3.json](evidence/aws-real-journey-v3.json), [audit-regressions.tap](evidence/audit-regressions.tap), [guardrails-http.json](evidence/manual-validation-20261118/guardrails-http.json), [http-probe.jsonl](evidence/manual-validation-20261118/http-probe.jsonl), [aws-load-catalog-50.json](evidence/aws-load-catalog-50.json) e [aws-load-catalog-50-stable.json](evidence/aws-load-catalog-50-stable.json).

## Segurança e operação: avanço documental, risco residual

O [runbook](operacao-incidentes.md) agora define diagnóstico, contenção, recuperação, reversão e encerramento. A [triagem da imagem](triagem-imagem.md) associa manifesto/digest, pacotes e CVEs, identifica pré-condições e uma inconsistência de associação do scanner. Isso é tratamento documentado melhor que apenas citar uma contagem, mas não equivale a remover os sete HIGH nem a verificar todas as capabilities, SUID/PAM e bibliotecas do runtime.

HTTP continua deixando a sessão sem confidencialidade em trânsito. HttpOnly/SameSite e dados fictícios reduzem determinados riscos, sem substituir TLS. O PDF não exige nominalmente domínio/ACM; a limitação decorre do critério de proteção de dados da rubrica. O SNS não possui assinante externo: execução de ação não comprova que um operador recebeu aviso. Os logs genéricos ainda podem melhorar em classificação sanitizada e correlação das ferramentas da IA até o evento assíncrono.

A [análise de capacidade e segurança](analise-capacidade-seguranca.md) explicita slots de memória, máximos e créditos burstable. Os recortes com métricas de host/banco complementam essa análise, sem provar o máximo simultâneo de seis APIs/quatro workers nem desempenho prolongado sem créditos. O orçamento é alerta, não trava de cobrança; os dois NAT/ALB continuam cobrando no mínimo. A manutenção do ambiente ligado foi autorizada pelo usuário.

## Estado final e avanço para a etapa 2

O snapshot de **18/11 às 13:27:42 UTC** registra API **1/1**, worker **1/1**, ambas as tasks HEALTHY, ASG mínimo/desejado **1**, máximo **4**, uma EC2 saudável e fila principal vazia. A DLQ também tem zero mensagens visíveis/em processamento. Os produtores e monitores foram encerrados e a política temporária de negação foi removida. Fontes: [infra-latest.json](evidence/manual-validation-20261118/infra-latest.json), [final-dlq.json](evidence/manual-validation-20261118/final-dlq.json) e [worker-policies-after-recovery.json](evidence/manual-validation-20261118/worker-policies-after-recovery.json). Um estado final saudável não significa que toda a janela anterior esteve livre de erros.

A etapa manual possui agora base operacional e evidências suficientes para iniciar a reconstrução em São Paulo. Devem acompanhar a etapa 2:

1. Terraform integral, estado remoto, ECR e dependências regionais independentes de Ohio, com criação/destruição reproduzíveis.
2. Tratamento do transporte da sessão e dos achados residuais da imagem, sem ocultar riscos ou assumir que trocar a distribuição zera CVEs.
3. Melhoria de rastreabilidade e calibração de escala/custo, preservando os testes anteriores com falhas e seus limites.
4. Manutenção explícita de dois perfis: operação econômica com mínimo 1 e demonstração/manutenção com réplicas e capacidade substituta adequadas.

Não há exigência literal de CI/CD, painel administrativo, número máximo de containers, RDS Multi-AZ ou 50 usuários com IA. Esses itens não devem virar obrigações inventadas. A+ no projeto inteiro exigirá também a etapa regional e qualidade operacional compatível em todas as dimensões; a demonstração manual concluída não substitui essa entrega.

Revisão de português concluída. Nenhuma modificação de infraestrutura ou código foi feita por este avaliador.
