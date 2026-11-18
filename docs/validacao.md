# Plano de validação

Testes locais focados não substituem demonstrações AWS. Usar dados fictícios e registrar início/fim, configuração, carga, IDs correlacionados e resultado esperado/observado. Metas de latência e limiares de escala são hipóteses até medir.

| Cenário                         | Evidência esperada                                                          | Situação inicial                                              |
| ------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 1. Perda de task de atendimento | Duas réplicas em hosts distintos; requisições continuam e task é reposta    | AWS: 219/219 HTTP 200 com reserva preservada                          |
| 2. Perda de EC2                 | ASG substitui host; tasks recuperadas; reservas preservadas                 | AWS: reposição concluída; 216/216 HTTP 200 na janela amostrada          |
| 3. Mensagem duplicada           | Mesmo evento não devolve estoque duas vezes                                 | AWS: duas mensagens, um ProcessedEvent, estoque preservado                                        |
| 4. Mensagem inválida            | Retentativas e entrada na DLQ, alarme                                       | AWS: 5 falhas, DLQ, alarme ALARM e ação SNS confirmados                           |
| 5. Última unidade concorrente   | Uma reserva; outro cliente recebe resumo atualizado                         | AWS: 201/409 e cancelamentos restauram estoque                                        |
| 6. Falha da IA                  | Bloquear novas operações comerciais; manter consulta/cancelamento/expiração | Local completo; AWS com falha conhecida e probe real isolado |
| 7. Subida e descida de tasks    | Contagens e métricas dos dois serviços sob cargas distintas                 | API 1→3→1; worker 1→4→3→2→1 por política em 18/11                                                  |
| 8. Inclusão de EC2              | Tasks pendentes resultam em capacidade, registro e uso do host              | AWS: EC2 1→3 comprovado                                                  |
| 9. Remoção com drenagem         | Sem interrupção relevante durante scale-in                                  | Host ocupado drenado sob 1.761 consultas HTTP 200 em 18/11; removido só depois de vazio                                                  |
| 10. Falha da publicação outbox  | Evento persistido e reenviado após recuperação                              | AWS: 403 efetivo, duas falhas, reenvio na terceira tentativa; estoque liberado uma vez                                |
| 11. Cancelamento × expiração    | Uma única liberação, estado final coerente                                  | Teste PostgreSQL local                                        |
| 12. Recriação de containers     | Conversa, carrinho, oferta e reservas preservados                           | AWS: preservados nas sondas de task e EC2                            |

## Execução de carga

Usar 10 sessões no cenário normal e 50 no pico; dividir também cenários de confirmação e fila. Métricas: p50/p95/p99 e erros das operações, tempo de primeira resposta e conclusão da IA, tasks/hosts, backlog, atraso de expiração e créditos CPU. Cada usuário simulado respeita o rate limit; testar 429 separadamente. Distinguir resposta com IA real de resposta mock.

Manter duração suficiente para os intervalos de métricas/cooldowns e para completar o ciclo de reservas de 15 minutos. Não alterar a duração comercial em produção para fabricar evidência de expiração. Fixtures locais podem ter vencimento antecipado para teste focado, claramente identificado.

## Guardrails adversariais

Tentar 90% de desconto, preço negativo, alteração de oferta pelo front, produto inexistente, quantidade inválida, oferta vencida, confirmação repetida com outra request key, acesso/cancelamento entre sessões e instruções para ignorar políticas. O modelo não recebe credenciais, custo ou margem. Validar também token de sessão, CSRF/origem, IP atrás do ALB e contadores compartilhados entre réplicas.

## Limites conhecidos

Mínimo 1 é modo econômico e tem interrupção em falha abrupta; demonstrar continuidade em pelo menos duas réplicas/hosts. Banco Single-AZ não tem failover multi-AZ. HTTP não cifra tráfego. O usuário autorizou manter o ambiente ligado. O orçamento de US$ 100 é acompanhado por alertas e não é um bloqueio de cobrança; NAT/ALB continuam cobrando com tasks mínimas. A+ só pode ser sustentado com resultados reais e limitações honestas.

## Medição inicial local

O script `scripts/load.mjs` cria sessões e respeita a espera de rate limit na preparação. A execução de 10 usuários por 10 segundos realizou 100 consultas, todas HTTP 200; p95 de aproximadamente 12,9 ms no computador local. Isso não mede negociação, fluxo de reserva sob carga, limites de CPU da EC2 ou autoscaling. Resultado bruto em `evidence/load-local-10.json`. Repetir os cenários relevantes na AWS.

## Evidências AWS já coletadas

Em 16/11/2026, o worker em ECS/EC2 acessou os 12 produtos com o papel `periferia_worker`, TLS validado e readiness 200. Uma requisição ao IMDS a partir do container foi bloqueada, e a regra de proteção do host estava presente. Resultado bruto no campo `worker_verification` de `aws-inventory.json`.

A mensagem de teste `6b6ae3ab-459a-4f19-bbed-4c7095b75084`, com formato propositalmente inválido e sem dados pessoais, gerou cinco registros `event.failed`, separados por aproximadamente 30 segundos, e apareceu na DLQ. Evidências: `evidence/aws-dlq-retries.json` e `evidence/aws-dlq-message.json`. O recebimento de inspeção na DLQ incrementou a contagem para seis; isso não representa uma sexta tentativa do worker na fila principal. O alarme entrou em ALARM às 12:52:54 UTC, após publicação da métrica da DLQ; a ação SNS foi confirmada pelo histórico do CloudWatch. Evidências em evidence/aws-dlq-alarm.json e evidence/aws-dlq-alarm-action.json. Não há assinantes externos do tópico. Somente essa mensagem descartável foi removida depois da coleta.

Repetição estável de carga: `evidence/aws-load-catalog-50-stable.json`,50 visitantes e 2.400 consultas, todas HTTP 200, p95 de 476 ms e p99 de 1.113 ms. O teste anterior de 2.736 tentativas teve 24 falhas de rede; sua causa permanece não isolada. As duas execuções não medem carga de IA real.

Resultados adicionais de 18/11: `ensaios-manual-fase2.md` e evidências em `evidence/manual-validation-20261118/`. Incluem guardrails HTTP 8/8, alarme outbox/SNS, métricas de throughput/idade/CPU/créditos e estado final mínimo. A sonda longa teve quatro erros após lacuna local; causa não isolada.
