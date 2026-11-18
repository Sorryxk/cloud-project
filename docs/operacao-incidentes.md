# Operação e resposta a incidentes

Escopo: ambiente manual de Ohio. Este procedimento descreve decisões operacionais; os testes efetivamente executados ficam em `evidence/`. Uma configuração de alarme não comprova que o procedimento foi ensaiado.

## Diagnóstico inicial

Registre horário UTC, sintoma, impacto e última alteração. Consulte o dashboard `Periferia-Ohio`, os eventos dos serviços ECS, a saúde dos targets do ALB e os grupos `/periferia/api` e `/periferia/worker`. Para uma falha HTTP, guarde o `X-Request-Id` e procure o mesmo identificador nos logs. Não copie cookies, chaves, senhas ou mensagens privadas para o relatório.

Compare contagens desejadas, pendentes e executando. Tasks pendentes com ASG no máximo podem indicar falta de capacidade; targets sem saúde podem indicar erro de inicialização, banco indisponível ou porta/SG incorretos. Examine o motivo de parada e os eventos antes de aumentar recursos. O mínimo de uma API ou um host admite interrupção em falha abrupta; dois hosts e duas APIs reduzem esse risco. RDS Single-AZ continua sendo ponto único de indisponibilidade.

## Fila atrasada ou expiração degradada

1. Compare mensagens visíveis, idade da mensagem mais antiga, número de workers, CPU/memória e `OldestExpirationLag`. O backlog da política é a quantidade visível dividida pelos workers executando; o limite é quatro workers.
2. Examine `worker.loop_failed`, `event.failed` e `outbox.send_failed`. Confirme acesso ao PostgreSQL e as permissões de receber, excluir e enviar na fila própria. Uma readiness saudável do worker verifica o banco; não garante acesso ao SQS.
3. Se o envio falhar, a outbox conserva o evento sem `sentAt`; a lease permite nova tentativa após 30 segundos. A recuperação pelo banco procura reservas vencidas há mais de 15 segundos, em laço separado. Não exclua a outbox nem altere o vencimento para esconder atraso.
4. Acima de 30 segundos de atraso em reservas ativas, a API bloqueia novas confirmações. Restaure a dependência antes de liberar o fluxo; não desative a proteção. Leituras e cancelamentos continuam disponíveis conforme a saúde do banco.
5. Depois da recuperação, confira `sentAt`, o estado terminal da reserva, o estoque reservado e a unicidade de `ProcessedEvent`. Confirme queda do backlog e da idade, ausência de novas falhas e redução automática de workers. Mensagens duplicadas são esperadas em SQS Standard.

## DLQ com mensagens

O alarme da DLQ já foi ensaiado. Registre o motivo e o identificador da mensagem, corrija a causa e só então avalie o reenvio. Mensagem fora do schema deve ser investigada; repetir indefinidamente o mesmo corpo inválido não resolve o problema. Não use purge para limpar evidências. Remova somente fixtures identificadas do teste quando autorizado. O SNS atual não possui assinante externo: a execução da ação não equivale a uma pessoa ter recebido aviso.

## IA indisponível

Confira `ai.failed` e os eventos da dependência, sem registrar a chave. Uma falha conhecida abre o bloqueio por 30 segundos; uma única réplica adquire a lease para um probe real antes de liberar a integração. Não substitua silenciosamente a IA real pelo modo simulado. Leituras, cancelamentos e expirações não dependem de uma resposta nova da IA. Verifique a resposta do provedor e a configuração do segredo antes de reiniciar tasks.

## Manutenção e reversão

Para retirar um host ocupado, disponibilize capacidade substituta, marque a container instance como `DRAINING` e aguarde as substitutas saudáveis, os targets válidos e as tarefas originais em `STOPPED`. Só então remova o host vazio. Não remova proteção de término de um host ocupado para forçar scale-in. A amostragem HTTP deve começar antes da intervenção e acompanhar também a retirada.

Em uma implantação malsucedida, consulte o circuit breaker e a revisão anterior antes de reverter. Reverter a imagem não reverte automaticamente o banco; avalie compatibilidade das migrações. Exclusão de recursos, dados ou migrações em massa exige autorização específica. Ao encerrar um ensaio, remova bloqueios temporários, pare produtores de carga e restaure mínimos de API, worker e ASG para um. Preserve o ambiente ligado conforme a decisão do usuário.

## Registro de encerramento

Anote causa comprovada ou hipótese ainda aberta, intervalo de impacto, ações, configuração final, evidências e prevenção. Registre separadamente falhas HTTP observadas e janelas não amostradas. Os alertas de orçamento não limitam automaticamente o gasto; capacidade extra, NAT, ALB, RDS e observabilidade continuam gerando custos enquanto ativos.
