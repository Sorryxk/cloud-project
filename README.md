# Periferia

Consulte [o índice de entrega](README-ENTREGA.md). Bedrock foi validado nos dois ambientes; a versão final ainda depende da reconstrução de São Paulo; os relatórios históricos têm seus cortes identificados.

MVP acadêmico de comércio conversacional: React + TypeScript + Vite, API e worker NestJS, PostgreSQL/Prisma e SQS com outbox transacional. A etapa manual foi concluída em Ohio. Um segundo ambiente funcional foi criado integralmente com Terraform em São Paulo, com recursos regionais novos e estado remoto. A migração Bedrock passou nos dois ambientes. A destruição/recriação de São Paulo está autorizada e ainda não foi executada.

## Executar localmente

Requisitos: Node.js 24, pnpm 11.25 e Docker. O modo de simulação não exige conta AWS. O modo real usa Bedrock e IAM, sem chave OpenAI.

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
- Negociação pelo carrinho: concessões graduais, teto de 20% por item e preço mínimo calculado pela margem sobre a venda. Cada nova concessão fica abaixo do percentual pedido; uma condição anterior válida pode ser mantida.
- Oferta de 10 minutos; não renovar sem nova condição comercial. Alterar carrinho exige nova oferta.
- Confirmação explícita pelo botão, transação de estoque e chave idempotente. Falta de estoque não cria reserva parcial silenciosa: atualiza o carrinho e exige nova confirmação.
- Reserva de 15 minutos, cancelamento explícito e expiração idempotentes.
- Outbox: evento de expiração gravado junto com a reserva. Publicação ocorre quando chega o vencimento; não usa temporizador em memória para preservar o prazo.
- Worker consome SQS; reprocessa expirações atrasadas independentemente da fila. Falhas repetidas vão para DLQ configurada no broker.
- Rate limit compartilhado no PostgreSQL, lease de chat por sessão e validação estrita de entradas.
- Respostas progressivas no chat e cartões de oferta com valores calculados pelo backend.
- Logs JSON sem credenciais; métricas CloudWatch EMF quando `NODE_ENV=production`.

## IA: simulação e integração real

`AI_MODE=mock` permite testes locais determinísticos e mostra um aviso no front. Não é IA generativa e **não atende sozinho ao requisito de IA do roteiro**. O modo real usa Amazon Bedrock (`AI_MODE=bedrock`), perfil `global.openai.gpt-6-luna`, Responses API com assinatura AWS SigV4 e a IAM Role da task API. Há ferramentas permitidas e limite de seis chamadas por interação. A produção recusa iniciar em modo simulado.

A migração de ambos os ambientes está documentada em [Bedrock](docs/bedrock.md). As jornadas anteriores usavam a API direta; os registros datados são preservados como histórico. Testes focados adicionais e carga de IA real ainda são necessários para afirmar robustez ampla. As ferramentas da IA não têm operação de confirmação/cancelamento. Custos e margens não são enviados ao modelo nem ao front.

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
- [Implantação automática em São Paulo](docs/terraform-sp.md)
- [Código e procedimento Terraform](infra/terraform/README.md)
- [Ensaios finais da etapa manual](docs/ensaios-manual-fase2.md)
- [Operação e incidentes](docs/operacao-incidentes.md)

Os dois ambientes funcionaram com Luna real na implantação anterior. Ohio e São Paulo passaram na jornada Bedrock em 19/11; São Paulo ainda precisa da reconstrução autorizada. Em Ohio, drenagem ocupada, escala do worker 1→4→3→2→1 e falha/recuperação real da outbox foram concluídas. Em São Paulo, a jornada real, guardrails HTTP, TLS no banco, permissões, hardening e plano Terraform sem mudanças foram verificados. O estado remoto foi comparado com os valores de quatro segredos em memória, sem encontrar esses valores no state.

A avaliação manual estimou A com ressalvas; segurança/operação permanece limitada por HTTP e riscos residuais da imagem. Não há garantia de A+ global. As evidências distinguem testes de cada região e preservam falhas e lacunas. Domínio próprio, painel administrativo, pagamento, entrega e CI/CD ficam fora do requisito literal.

O código possui repositório Git local na branch main, sem publicação remota. O checkpoint está registrado em `docs/evidence/source-version.json`; o pacote de entrega inclui um bundle para inspeção offline do histórico. O primeiro commit foi criado em 18/11 e não representa histórico anterior de desenvolvimento.
