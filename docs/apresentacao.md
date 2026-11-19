# Roteiro de apresentação

O tempo abaixo é uma sugestão de organização; o enunciado não fixa duração. Ajustar à orientação do professor. Mostrar dados fictícios e nunca abrir valores de segredos ou credenciais na projeção.

1. **Problema e arquitetura:** explicar a loja, o vendedor por IA e a separação entre API síncrona e worker assíncrono. Mostrar VPC em duas AZs, ALB, hosts privados, RDS, SQS/DLQ e Bedrock. Destacar ECS sobre EC2 e Capacity Provider, sem Fargate como capacidade principal.
2. **Jornada comercial:** conversar, consultar catálogo, adicionar ao carrinho e pedir desconto. Mostrar contraproposta calculada no backend, resumo e confirmação explícita. Confirmar a reserva, repetir a requisição idempotente e demonstrar cancelamento ou expiração. Explicar que o frontend não acessa o banco.
3. **Persistência:** preservar conversa e reserva durante substituição da task. Mostrar que o dado não depende do disco do container. Usar evidências datadas se o ensaio completo não couber na apresentação.
4. **Elasticidade:** relacionar a carga ao número de tasks da API, backlog ao worker e demanda do cluster às EC2. Apresentar séries de subida e descida, limites configurados e resultados quantitativos. Identificar replays sintéticos; não chamá-los de vendas distintas.
5. **Falha e recuperação:** mostrar drenagem ocupada, reposição e retirada do host, repetição idempotente, DLQ e falha real/reenvio da outbox. Abrir o dashboard e o runbook, explicando o diagnóstico e a recuperação observados.
6. **Terraform em São Paulo:** mostrar parâmetros, módulo, lockfile e backend remoto. Demonstrar os recursos regionais novos, o ECR da região, o bootstrap e a jornada funcional. Mostrar o registro do ciclo real de destruição/recriação somente depois de executado. Um plano de destroy não comprova a remoção.
7. **Decisões e limitações:** justificar custo, mínimo de uma réplica, banco Single-AZ e políticas de escala. Explicitar HTTP, achados da imagem, limites de cada teste e ausência de destinatário externo do SNS. Mostrar o parecer final da rubrica com o mesmo corte da entrega.

## Conferência antes da defesa

- Confirmar saúde e acesso às duas URLs; verificar Bedrock com a role da API, sem usar o sucesso de um administrador como prova de menor privilégio.
- Conferir catálogo e estoque suficientes para a demonstração e cancelar somente as reservas de teste criadas pela equipe.
- Usar duas réplicas e capacidade substituta adequada quando demonstrar continuidade em falhas; depois restaurar os mínimos aprovados.
- Abrir código, diagrama, inventário, gráficos e logs sanitizados antes da apresentação. Guardar uma cópia local das evidências como apoio; ela não substitui a aplicação funcional exigida.
- Não destruir o ambiente durante a defesa sem combinar a janela. O ciclo autorizado de São Paulo deve ter logs e resultados próprios; Ohio e o bucket de estado ficam preservados.
- Conferir commit e hashes do material entregue. Apresentar o relatório final, sem usar uma estimativa antiga como nota definitiva do professor.
