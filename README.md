# Periferia

MVP acadêmico de comércio conversacional: React + TypeScript + Vite, API e worker NestJS, PostgreSQL/Prisma e SQS com outbox transacional. Infraestrutura da primeira etapa está sendo implantada manualmente em Ohio; este projeto não usa Terraform nesta etapa.

## Executar localmente

Requisitos: Node.js 24, pnpm 11.25 e Docker. Não é necessária uma chave OpenAI para o modo de simulação.

```sh
cp .env.example .env
pnpm install
pnpm generate
docker compose up -d
pnpm db:migrate
pnpm db:seed
pnpm build
```

Em três terminais, na raiz do projeto:

```sh
pnpm start:api
pnpm start:worker
pnpm dev:web
```

Abra http://localhost:5187. O Vite encaminha `/api` à porta 3187. Para testar o build servido pelo próprio NestJS, acesse http://localhost:3187 e ajuste `WEB_ORIGIN` no `.env` para essa origem antes de iniciar a API. As portas de PostgreSQL/SQS são exclusivas deste projeto e só escutam no loopback.

A senha de `.env.example` é fictícia e serve somente ao PostgreSQL local. O `.env` é ignorado. Não adicionar credenciais reais ao repositório. Na AWS, segredos são injetados pelo Secrets Manager.

## O que funciona

- Catálogo inicial de 12 produtos fictícios com estoque real no PostgreSQL.
- Visitante identificado por token aleatório em cookie HttpOnly; só informa o nome.
- Carrinho, conversa, oferta e reserva persistidos. Não há estado essencial no disco do container.
- Negociação pelo carrinho: concessões graduais, teto de 20% por item e preço mínimo calculado pela margem sobre a venda. A primeira contraproposta não aceita automaticamente o percentual pedido.
- Oferta de 10 minutos; não renovar sem nova condição comercial. Alterar carrinho exige nova oferta.
- Confirmação explícita pelo botão, transação de estoque e chave idempotente. Falta de estoque não cria reserva parcial silenciosa: atualiza o carrinho e exige nova confirmação.
- Reserva de 15 minutos, cancelamento explícito e expiração idempotentes.
- Outbox: evento de expiração gravado junto com a reserva. Publicação ocorre quando chega o vencimento; não usa temporizador em memória para preservar o prazo.
- Worker consome SQS; reprocessa expirações atrasadas independentemente da fila. Falhas repetidas vão para DLQ configurada no broker.
- Rate limit compartilhado no PostgreSQL, lease de chat por sessão e validação estrita de entradas.
- Respostas progressivas no chat e cartões de oferta com valores calculados pelo backend.
- Logs JSON sem credenciais; métricas CloudWatch EMF quando `NODE_ENV=production`.

## IA: simulação e integração real

`AI_MODE=mock` permite testes locais determinísticos e mostra um aviso no front. Não é IA generativa e **não atende sozinho ao requisito de IA do roteiro**. O modo real está implementado com Responses API, modelo `gpt-6-luna`, ferramentas permitidas e limite de seis chamadas por interação. A produção recusa iniciar em modo simulado.

A chave foi configurada por último diretamente no Secrets Manager. A jornada real com Luna passou por recomendação, proposta, objeção, tentativa de injeção, confirmação e cancelamento. Testes focados adicionais e carga de IA real ainda são necessários para afirmar robustez ampla. As ferramentas da IA não têm operação de confirmação/cancelamento. Custos e margens não são enviados ao modelo nem ao front.

## Verificar

```sh
pnpm typecheck
pnpm build
pnpm test:reservations
# Com a API local executando:
pnpm test:http
```

O último comando executa testes focados do fluxo de reservas com PostgreSQL e SQS locais. Usa fixtures próprias, sem apagar os dados da loja. Não executar contra banco de produção. O resultado local não comprova elasticidade ou disponibilidade na AWS.

## Implantação e evidências

- [Decisões e limites](docs/decisoes.md)
- [Matriz de conformidade do roteiro](docs/roteiro.md)
- [Procedimento manual AWS](docs/aws-manual.md)
- [Plano dos 12 cenários](docs/validacao.md)
- [Estado verificado e pendências](docs/estado.md)

Infraestrutura AWS criada em Ohio; banco preparado e worker em execução. API pública com Luna real validada. Escala da API e EC2, estoque concorrente, substituição de task e expiração real foram demonstrados; há pendências de carga/worker/ciclo de remoção e ressalvas documentadas. Consulte o estado e a avaliação independente. Domínio próprio, painel administrativo, pagamento, entrega e CI/CD ficam fora do escopo.
