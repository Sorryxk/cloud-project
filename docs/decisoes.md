# Decisões aceitas

## Escopo

Meta A+, priorizando evidências de infraestrutura. Etapa manual em `us-east-2`, sem Terraform, CloudFormation ou CDK; etapa automática em `sa-east-1`, com Terraform. Conta AWS normal acessada pelo portal SSO indicado pelo usuário, região Ohio. O login foi realizado pelo usuário; a integração passou a usar Bedrock com IAM, sem chave OpenAI; credenciais temporárias são renovadas sem criar chaves permanentes. Ao precisar de novo login interativo, abrir a aba e avisar.

Loja de periféricos com três teclados, três mouses, três headsets e três monitores. Marcas e produtos do catálogo são fictícios; não usar alegações de avaliações ou desempenho sem dados. Visitante fornece somente nome. Múltiplas reservas permitidas; quantidade limitada somente pelo estoque.

## Regras comerciais

- Negociação pelo total do carrinho, com contrapropostas. Nunca aceitar automaticamente o pedido de desconto.
- Teto de 20% por item, sem furar o piso individual: custo / (1 - margem mínima). Margem é percentual sobre o preço de venda.
- Cadastro inicial inclui custo e margem mínima por produto. Sem painel administrativo ou função pública de atualização.
- Gatilhos de venda baseados em dados reais. Até uma sugestão complementar por fechamento; aceitação explícita para incluir. Perguntar antes de superar o orçamento.
- Oferta vale 10 minutos sem renovação automática. Mudança de produtos/quantidades invalida a condição anterior.
- Nenhuma reserva é criada antes do botão de confirmação do resumo completo. Se a disponibilidade mudar, ajustar e pedir nova confirmação, sem reservar silenciosamente os outros itens.
- Reserva dura 15 minutos; não há pagamento ou venda definitiva. Cancelamento antecipado permitido, com confirmação.
- Liberação do estoque com atraso de até 30 segundos em operação normal. Recuperação periódica e alarme para atrasos maiores. Proposta de pausa protetiva de novas reservas acima de 30 segundos implementada sob autorização de decidir os detalhes restantes.
- Falha conhecida da IA bloqueia carrinho/ofertas/novas reservas. Consulta, cancelamento e expiração continuam. O estado da dependência é atualizado nas chamadas; não existe garantia de detectar uma falha externa antes de qualquer chamada. Após falha conhecida, o fim do cooldown autoriza somente um probe real, com lease/CAS entre réplicas; novas operações comerciais só são liberadas depois de recuperação confirmada.

## Tecnologia

Monorepo: front React/TypeScript/Vite; API e worker NestJS/TypeScript; Prisma; PostgreSQL RDS Single-AZ; SQS Standard + DLQ; Secrets Manager; logs CloudWatch. Front servido pela API em produção. Worker independente, acesso privado ao banco com credencial e permissões próprias, compartilhando as regras da API.

Backend calcula toda condição comercial e controla autorização, prazos, estoque, idempotência e rate limit. Front apenas apresenta estado, coleta entradas e renderiza contagens regressivas indicativas; o horário do backend decide a validade.

## Infraestrutura inicial

| Recurso           | Inicial/mínimo | Máximo |
| ----------------- | -------------: | -----: |
| Tasks atendimento |              1 |      6 |
| Tasks worker      |              1 |      4 |
| EC2               |              1 |      4 |

EC2 `t3.small` como hipótese inicial. Container: CPU 256 unidades, reserva de memória 512 MiB e limite 512 MiB. CPU do container representa shares na EC2; o template também define CPU 256 no nível da task como teto. Validar consumo e empacotamento. RDS `db.t4g.micro`, 20 GiB gp3, backup 7 dias. Tudo ajustável por medição.

VPC própria em duas zonas, sub-redes públicas e privadas, dois NAT Gateways. ALB público HTTP no DNS padrão; somente demonstração com dados fictícios. EC2 e RDS privados. Sem SSH público; Session Manager. IAM separados para EC2, execução de tasks e aplicações.

Modo econômico com uma réplica não garante continuidade durante falha abrupta. Nos testes de disponibilidade, elevar para pelo menos duas tasks de atendimento em duas EC2 e documentar a diferença. Não afirmar que autoscaling elimina a interrupção com uma única réplica. RDS Single-AZ também é ponto único de indisponibilidade.

## Elasticidade e orçamento

Cenário de carga proposto: 10 usuários simultâneos, pico de 50. Atendimento por requisições/target; worker por backlog e idade; EC2 pelo Capacity Provider. Limiares ainda precisam de medição. Idade da mensagem SQS só mede o período na fila: para prazo de reservas, usar também vencimentos no PostgreSQL e métrica `OldestExpirationLag`.

Teto AWS US$ 100; a migração para Bedrock inclui a cobrança de IA na AWS. Quantidade de tasks não equivale a capacidade física garantida. Implantação usa rede bridge e portas dinâmicas, evitando o limite ENI de awsvpc nas T3 pequenas. Host registrou 1.657 MiB utilizáveis; reserva de 512 MiB por task admite até três por host. Máximos de 6+4 requerem quatro hosts e ainda precisam de validação sustentada de CPU/memória.

Dois NAT Gateways custam aproximadamente US$ 0,09/h juntos em Ohio, sem IPv4/tráfego. Só essa parcela chega a US$ 65,70 em 730h. Mínimo 1 não assegura teto de US$ 100: estimar duração e custo total da infraestrutura antes de criar. Budget e alarmes não são um bloqueio rígido de gastos. Recursos AWS foram criados manualmente em Ohio. O usuário autorizou mantê-los ligados sem desligamento programado. O orçamento não impede cobrança acima de US$ 100.

## Proteções e observabilidade

Chat 10/min; confirmação 10/min; cancelamento 10/min; leitura 120/min por sessão. Carrinho 30/min; ofertas 10/min. Teto amplo IP 1.200/min, criação de sessão 30/min; calibrar para a rede compartilhada da faculdade. Contadores PG atômicos. Uma interação de chat em andamento por sessão; até seis chamadas do modelo, timeout total e sem retentativas automáticas do SDK.

Dashboard CloudWatch com ALB, ECS, EC2/ASG, RDS, SQS/DLQ e métricas de reservas. Logs por 30 dias, sem chaves/tokens ou custos/margens. Guardar gráficos e resultados de teste. Não prometer ausência de jailbreak: a IA não tem autoridade para alterar regras nem confirmar em nome do cliente.

## Migração Bedrock aceita em 18/11

Manual em Ohio e automático em São Paulo usam o perfil `global.openai.gpt-6-luna` pelo Bedrock. As credenciais de inferência vêm da role temporária da task API. O SDK OpenAI serve somente ao protocolo Responses, com endpoint AWS e assinatura SigV4. O perfil global pode processar em outras regiões; isso não reutiliza os recursos da loja de Ohio. Estado de implantação e evidências atuais em `estado.md` e `bedrock.md`.
