# Ensaios adicionais da etapa manual

Escopo autorizado: Ohio, com os recursos existentes, sem Terraform. Os mínimos operacionais voltam a 1 após os ensaios. A infraestrutura permanece ligada por decisão do usuário.

| Ensaio | Tipo | Procedimento e cobertura | Critério de aprovação |
| --- | --- | --- | --- |
| Drenagem ocupada | Integração e resiliência AWS | Duas API tasks saudáveis, capacidade extra temporária para manutenção, sonda HTTP iniciada antes da alteração; selecionar host ocupado em uma AZ com outra EC2 e mudar para DRAINING. | Registrar a saída das tasks, reposição saudável, remoção somente depois de esvaziar e estado persistente. Informar todos os erros e latências observados. |
| Worker | Carga e elasticidade AWS | Medir a taxa de consumo e manter backlog controlado de eventos válidos referentes a reservas de teste já vencidas; distinguir replays sintéticos de vendas. Observar escala automática, esvaziamento e retorno. | Worker expande e reduz por sua política; fila e tempos são medidos; estoque não é liberado duas vezes. Limites: 4 workers, 4 EC2, publicador com duração e volume máximos. |
| Outbox | Injeção de falha e recuperação AWS | Confirmar primeiro a recusa de envio usando as credenciais do worker. Manter uma reserva com prazo comercial real de 15 minutos e observar a outbox durante a falha. Restaurar o acesso e confirmar reenvio. | Evento permanece no banco enquanto o envio falha, tentativas aumentam, estoque é liberado uma única vez, envio se recupera e a deduplicação permanece consistente. |

A sonda registra horário, status HTTP, erro de transporte, latência e presença da reserva. Snapshots registram tasks, hosts, fila e alvos do ALB. A tentativa inicial está preservada em `evidence/phase2/`; a repetição de 18/11 está em `evidence/manual-validation-20261118/`.

Nenhum ensaio altera a duração comercial para fabricar expiração. Os eventos de carga são identificados como dados sintéticos. Não se envia nome, cookie ou chave para a fila ou para os relatórios. Qualquer política temporária de falha deve ser removida ao encerrar o ensaio, inclusive se o resultado for negativo.

## Histórico: coleta inicial de 16/11 e bloqueio de autenticação

A EC2 `i-08d52b3b70d96ff82` foi colocada em DRAINING enquanto executava uma API. A sonda já estava ativa antes da alteração e a reserva de teste permaneceu visível. Foi observado um erro de transporte ECONNRESET; ele está preservado nos dados brutos e sua causa ainda não foi isolada. O host de origem ainda executava a task na última leitura autenticada, posterior ao reset; não foi comprovado que o erro tenha sido causado pelo encerramento da aplicação.

A credencial temporária da CLI e a sessão SSO expiraram. O portal foi aberto para novo login do usuário. A coleta de infraestrutura ficou interrompida; portanto, o ensaio ainda não foi aprovado nem a remoção do host foi executada. As requisições de diagnóstico posteriores não reproduziram o reset, o que não explica o evento original.

Naquele corte, o publicador do worker e a falha da outbox não haviam sido iniciados, e os mínimos temporários de API/ASG eram 2. Esse estado histórico não representa a configuração final de 18/11.

## Repetição de 18/11: drenagem ocupada aprovada

O host `i-0a28009f621f5b91a` executava uma API e um worker quando recebeu DRAINING às 11:34:28 UTC. A sonda e os dez visitantes já estavam ativos. ECS iniciou substitutas, preservou os targets saudáveis e parou as tarefas originais com motivo explícito de drenagem. A API original terminou às 11:38:29 UTC, depois da desassociação do ALB; o worker terminou antes. A retirada da EC2 foi solicitada somente às 11:39:35 UTC, com zero tarefas executando ou pendentes no host.

A carga começou às 11:33:21 e terminou às 11:40:23 UTC: **1.761 consultas ao catálogo, todas HTTP 200**, p95 de **630,6 ms**. A sonda independente confirmou a presença da reserva durante a troca. O ensaio usou duas APIs e capacidade extra temporária; não demonstra a mesma continuidade com mínimo de uma réplica. Evidências: `drain-load.json`, `drain-summary.json`, `infra-snapshots.jsonl` e `http-probe.jsonl`.

## Worker: ciclo automático completo aprovado

Uma linha de base publicou 100 mensagens. A carga principal publicou **24.680 replays válidos**, sem falhas de publicação, durante aproximadamente 365 segundos; os corpos representam 12 eventIds referentes a três reservas de teste já encerradas. Não são 24.680 vendas ou expirações diferentes. O banco confirmou 12 registros ProcessedEvent para os 12 IDs.

O alarme de backlog por worker recebeu três pontos de 60 segundos acima do alvo 10 e acionou a política às **11:44:06 UTC**, ajustando o desejado de 1 para 4. O snapshot iniciado às 11:44:25 já encontrou quatro workers executando. A elevação transitória de 1 para 2 durante a drenagem anterior não foi contada como autoscaling.

Nos minutos 11:40–11:43 com um worker, a média observada foi de aproximadamente **2.431 exclusões/minuto**. No minuto 11:45, com quatro workers, foram **8.003 exclusões/minuto**: razão observada de 3,29 vezes. É comparação entre janelas do mesmo ensaio, sem isolamento causal de benchmark; replays e contenção sobre poucas reservas limitam a extrapolação para vendas reais. Métricas SQS são aproximadas. A maior média de backlog em 60 segundos foi 6.671; a sondagem aproximada chegou a 9.571. A idade máxima registrada foi 209 segundos.

O publicador encerrou às 11:46:06 UTC. A fila apresentou valores aproximados oscilantes antes de estabilizar em zero; não se deve tratar a primeira leitura zero isolada como esvaziamento definitivo. O histórico confirmou reduções automáticas **4→3 às 12:02:48, 3→2 às 12:08:48 e 2→1 às 12:14:48 UTC**, todas bem-sucedidas. A primeira redução ocorreu cerca de 16 min 42 s após o fim da publicação; o retorno a um worker levou 28 min 42 s. A janela de avaliação e o cooldown tornam a redução deliberadamente mais lenta que a subida; há custo de capacidade ociosa nesse período. Não foi preciso alterar manualmente o desejado do worker.

O Capacity Provider também reduziu a frota de **2 para 1 EC2 às 12:30:55 UTC**, após uma tentativa cancelada pela proteção de scale-in. A remoção manual anterior de 3 para 2 pertence ao ensaio de drenagem; não foi contada como redução automática. Fontes: `worker-load-publication-summary.json`, `worker-replay-idempotency.json`, `final-worker-scaling.json`, `final-ec2-scaling.json`, arquivos `*-metrics.json` e snapshots.

## Falha real e recuperação da outbox aprovadas

A reserva manteve prazo comercial de aproximadamente 900 segundos e venceu às **11:48:03.052 UTC**. O bloqueio temporário de SendMessage foi confirmado com **HTTP 403 usando a task role do worker antes do vencimento**. Houve duas tentativas reais de publicação, registradas em `outbox.send_failed`; a outbox permaneceu com `sentAt` nulo.

A recuperação independente pelo PostgreSQL gravou EXPIRED às **11:48:19.254 UTC**, atraso de **16,202 segundos**, devolvendo a unidade reservada: estoque 20, reservado 0. Depois da remoção do bloqueio, a terceira tentativa publicou às **11:49:03.228 UTC**. O banco confirmou `sentAt` preenchido, lease liberada e **um único ProcessedEvent**, sem nova liberação de estoque. A remoção da política foi seguida de um probe real com HTTP 200; a propagação IAM não foi presumida instantânea.

O novo alarme `periferia-outbox-falhas` observa OutboxFailures diretamente, pois falhas de envio tratadas dentro de dispatch não incrementam WorkerFailures. O histórico confirmou ALARM pelo ponto de duas falhas e execução bem-sucedida da ação SNS. O tópico não possui assinante externo. Evidências: `outbox-recovery-summary.json`, `outbox-failure-logs.json`, `outbox-alarm-history.json` e `worker-policies-after-recovery.json`.

## Limites e encerramento

Os mínimos configurados de API e ASG foram restaurados para 1; o mínimo do worker permaneceu 1. Nenhuma política temporária de negação permanece. O snapshot das **13:27:42 UTC** confirmou API 1/1, worker 1/1, uma EC2 saudável, nenhuma task pendente e fila/DLQ vazias. Publicador e monitores foram encerrados. O ambiente segue ligado. A varredura do manifesto amd64 V3 foi vinculada ao índice implantado, e a triagem dos sete HIGH está em `triagem-imagem.md`; triagem não equivale a remoção dos achados. HTTP, mínimo de uma réplica e RDS Single-AZ continuam limitações explícitas.

A sonda longa terminou com **1.007 HTTP 200 em 1.011 tentativas**, p95 de **814,1 ms**, reserva preservada em todas as respostas bem-sucedidas. Após uma lacuna local de aproximadamente 15 minutos, houve dois TimeoutError e dois erros de DNS ENOTFOUND, entre 12:12:48 e 12:13:01 UTC; consultas voltaram a 200 às 12:13:12. As consultas AWS também registraram assinaturas expiradas em pausas posteriores. Esses indícios não isolam a causa dos erros HTTP nem comprovam falha AWS: preservar as lacunas e os quatro erros, sem apresentar a sonda inteira como disponibilidade sem falhas. O resultado de 1.761/1.761 da drenagem corresponde a outra janela e outra carga.

O teste adicional de guardrails HTTP aprovou oito negativos, sem alterar carrinhos, reservas ou disponibilidade. Não testou jailbreak generativo, exaustão de rate limit nem acesso a uma reserva existente de outra sessão. Evidência em `guardrails-http.json`.

Os timestamps dos snapshots identificam o início da coleta sequencial das consultas AWS, não um instante atômico comum a todas as respostas. Use os horários dos eventos do serviço para transições exatas. As figuras em `validacao-manual.png`/`.pdf` são geradas por `scripts/plot-manual-validation.py`; suas contagens refletem o corte disponível ao gerar.
