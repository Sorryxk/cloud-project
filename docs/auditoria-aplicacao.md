# Auditoria da aplicação — 16/11/2026

## Escopo e método

Revisão independente da aplicação em `/Users/soria/Documents/Codex/2026-11-12/c/outputs/periferia`, considerando as decisões explícitas do usuário e as evidências disponíveis da etapa manual em Ohio. Esta revisão não atribui o conceito global da disciplina nem substitui a auditoria de infraestrutura.

Foram lidos diretamente código, testes e resultados locais/AWS. Foram executadas duas reproduções isoladas contra as classes reais compiladas, com doubles de persistência em memória: negociação por rodada e abertura da disponibilidade após o prazo de falha. Essas reproduções não acessaram rede ou banco. Não foram lidos segredos, modificados recursos AWS, criadas fixtures remotas ou executada a suíte completa. Na fase inicial, o código não foi alterado por este auditor. As correções autorizadas posteriormente estão registradas no adendo ao final.

Os testes de falha AWS e a investigação do erro `Failed to fetch` da prévia local estavam sendo conduzidos pelo agente principal. Seus resultados posteriores precisam ser incorporados à avaliação final.

## Achados que exigem decisão ou correção

### 1. O pedido de desconto pode ser aceito automaticamente após a primeira rodada

**Prioridade: alta para aderência às regras comerciais; o teto financeiro continua protegido.**

O usuário definiu que a negociação nunca deve aceitar automaticamente o desconto solicitado. A implementação aplica a restrição de ficar abaixo do pedido somente na primeira rodada. A partir da segunda, o desconto é o menor valor entre 20%, três pontos percentuais por rodada e o próprio pedido. Assim, o resultado pode coincidir exatamente com o percentual pedido.

Fonte: [shop.ts:156](/Users/soria/Documents/Codex/2026-11-12/c/outputs/periferia/src/server/shop.ts:156). O comentário em [shop.ts:151](/Users/soria/Documents/Codex/2026-11-12/c/outputs/periferia/src/server/shop.ts:151) promete uma regra mais ampla do que o cálculo efetivamente garante.

Reprodução isolada, com produto de R$ 100,00 e piso inferior aos preços resultantes:

| Rodada | Pedido do cliente | Desconto calculado |
| --- | ---: | ---: |
| 1 | 5% | 3% |
| 2 | 5% | 5% |
| 7 | 20% | 20% |
| 8 | 20% | 20% |

O prompt pede que a IA considere objeção, intenção de compra e valor do carrinho, mas a ferramenta recebe apenas `requestedPercent`; a política de concessão no backend depende de rodada e pedido, sem uma decisão comercial estruturada adicional. Fontes: [ai.ts:75](/Users/soria/Documents/Codex/2026-11-12/c/outputs/periferia/src/server/ai.ts:75), [ai.ts:86](/Users/soria/Documents/Codex/2026-11-12/c/outputs/periferia/src/server/ai.ts:86) e [ai.ts:140](/Users/soria/Documents/Codex/2026-11-12/c/outputs/periferia/src/server/ai.ts:140).

Isso não comprova que o modelo aceitará qualquer pedido em conversa real: ele escolhe se chama a ferramenta. Comprova que a regra absoluta não é assegurada pelo backend e que a evidência de uma única contraproposta não cobre as demais rodadas. O teste chamado “negociação nunca aceita automaticamente” verifica uma primeira rodada com pedido de 20%, depois apenas teto e piso: [reservations.test.ts:170](/Users/soria/Documents/Codex/2026-11-12/c/outputs/periferia/src/test/reservations.test.ts:170).

Recomendação: definir a política explicitamente para todas as rodadas e testar pedidos que coincidam com o degrau autorizado. O modelo pode propor uma estratégia comercial; o backend deve validar a contraproposta, preservando o teto e os pisos.

### 2. O prazo de 30 segundos reabre operações comerciais sem comprovar recuperação da IA

**Prioridade: alta se a regra aprovada for manter novas operações bloqueadas durante toda a indisponibilidade conhecida.**

Após uma falha, a dependência recebe `failedUntil = agora + 30 segundos`. `assertAvailable()` libera a operação quando esse prazo vence, desde que a chave seja não vazia. Os endpoints de carrinho, oferta e confirmação usam essa verificação, sem testar a recuperação do provedor. Uma indisponibilidade prolongada permite que operações comerciais voltem a ocorrer após 30 segundos, mesmo sem uma chamada bem-sucedida à IA.

Fontes: [ai.ts:105](/Users/soria/Documents/Codex/2026-11-12/c/outputs/periferia/src/server/ai.ts:105), [ai.ts:294](/Users/soria/Documents/Codex/2026-11-12/c/outputs/periferia/src/server/ai.ts:294), [http.ts:79](/Users/soria/Documents/Codex/2026-11-12/c/outputs/periferia/src/server/http.ts:79) e [http.ts:89](/Users/soria/Documents/Codex/2026-11-12/c/outputs/periferia/src/server/http.ts:89).

Reprodução isolada: `AI_MODE=openai`, chave placeholder não vazia, dependência com `failedUntil` vencido há um milissegundo. A chamada real a `Ai.assertAvailable()` terminou com sucesso, sem rede ou teste do provedor.

Não é um defeito deixar de detectar uma falha externa antes da primeira chamada. A lacuna está em tratar o fim do cooldown como recuperação para endpoints que não chamam o modelo. O documento de decisões descreve a implementação como bloqueio de “falha conhecida”, portanto o comportamento precisa ser confrontado com a interpretação final da decisão do usuário, sem confundir cooldown com evidência de saúde.

Recomendação: permitir uma tentativa controlada de recuperação pelo chat depois do cooldown; liberar novas operações comerciais somente após sucesso. Manter consulta, cancelamento e expiração independentes.

### 3. Reservas ativas mais antigas ficam invisíveis após 30 reservas na sessão

**Prioridade: média.**

O usuário permitiu múltiplas reservas, limitadas pelo estoque, e cancelamento antecipado. A API devolve somente as 30 reservas mais recentes, sem paginação nem filtro que preserve todas as reservas ativas: [shop.ts:66](/Users/soria/Documents/Codex/2026-11-12/c/outputs/periferia/src/server/shop.ts:66). O frontend renderiza apenas esse array: [main.tsx:584](/Users/soria/Documents/Codex/2026-11-12/c/outputs/periferia/apps/web/src/main.tsx:584).

Com 31 reservas antes de expirarem, a mais antiga deixa de aparecer para o visitante e não pode ser cancelada pela interface, embora continue no banco e possa consumir estoque. A soma dos estoques iniciais permite esse cenário, e o limite de 10 confirmações por minuto não impede criar 31 reservas dentro de 15 minutos. A constatação decorre da consulta e da interface; não foi criado esse volume de reservas na AWS.

Recomendação: retornar todas as reservas ativas e paginar o histórico finalizado, ou fornecer paginação acessível na interface.

### 4. Logs de falha da IA têm informação insuficiente para diagnóstico operacional

**Prioridade: média para a meta A+.**

O log de falha registra somente `errorType`, sem status HTTP, código seguro do erro ou ID da requisição ao provedor: [ai.ts:290](/Users/soria/Documents/Codex/2026-11-12/c/outputs/periferia/src/server/ai.ts:290). O worker também registra falhas genéricas sem identificar qual loop falhou: [worker.ts:125](/Users/soria/Documents/Codex/2026-11-12/c/outputs/periferia/src/server/worker.ts:125).

A evidência `aws-openai-diagnostic.json` precisou de um diagnóstico separado para identificar `401 invalid_api_key`. Isso não invalida a centralização de logs e métricas, mas limita a alegação de diagnóstico completo pela observabilidade já implantada.

Recomendação: registrar campos seguros e limitados, como etapa, status, código do erro e ID da requisição, sem chave, cabeçalhos de autenticação, corpo integral ou dados pessoais.

## Controles e comportamentos sustentados pelas fontes

| Controle | Fonte verificada | Alcance da conclusão |
| --- | --- | --- |
| Teto de 20% e piso por produto | `src/server/shop.ts:20–34` | O cálculo limita o desconto e respeita margem sobre venda; isso independe da resposta textual da IA. |
| Backend determina valores | `src/server/http.ts:91–100`; `src/server/shop.ts:236–297` | Confirmação aceita identificação da oferta, nome, chave idempotente e consentimento; preço vem da oferta persistida. |
| IA não confirma nem cancela | `src/server/ai.ts:13–81`; `src/server/http.ts:84–114` | As ferramentas expostas ao modelo são catálogo, carrinho, proposta e negociação. A reserva é uma operação HTTP separada. |
| Confirmação explícita e idempotente | `src/server/shop.ts:210–217`; `prisma/schema.prisma:67–79` | Bloqueio de sessão e unicidades impedem duplicar a mesma oferta/chave. A jornada AWS repetiu a confirmação e permaneceu com uma reserva. |
| Estoque protegido em concorrência | `src/server/shop.ts:250–287` | Produtos são bloqueados em ordem e revalidados antes de reservar. Teste AWS da última unidade produziu 201 e 409 e restaurou o estoque por cancelamento. |
| Falta de estoque exige nova confirmação | `src/server/shop.ts:261–282`; `src/server/shop.ts:316–324` | O carrinho é ajustado, a versão muda e nenhuma reserva parcial é criada no mesmo clique. |
| Reserva de 15 minutos | `src/server/shop.ts:297` | Horário definido pelo backend; a jornada real verificou duração aproximada de 900 segundos. Expiração efetiva na AWS ainda precisava ser coletada pelo agente principal no corte desta revisão. |
| Cancelamento autorizado e liberação única | `src/server/shop.ts:350–376` | Sessão é conferida e o estado muda sob bloqueio da reserva. Há testes locais concorrentes e teste AWS de cancelamento de outra sessão com 404. |
| Outbox transacional | `src/server/shop.ts:289–306`; `src/server/worker.ts:33–58` | Evento é persistido na mesma transação; publicação posterior usa claim e lease. Falha de envio deixa o evento para nova tentativa. |
| Duplicidade e DLQ | `src/server/shop.ts:354–376`; `src/server/worker.ts:71–92` | Eventos repetidos são identificados e mensagens inválidas não são excluídas como sucesso. Evidência AWS registra cinco falhas, DLQ e alarme/SNS. |
| Recuperação sem fila | `src/server/worker.ts:96–115` | Reconciliação consulta reservas vencidas no PostgreSQL; há teste local dedicado. O limite de 30 segundos sob carga depende de medição. |
| Rate limit compartilhado | `src/server/security.ts:15–30` | Contador PostgreSQL atômico, compartilhável entre réplicas. Teste local verificou 10 êxitos e duas rejeições em 12 chamadas concorrentes. |
| Sessão e proteção de origem | `src/server/security.ts:33–75` | Cookie aleatório com hash no banco, HttpOnly e SameSite Strict; origem e cabeçalho de mutação verificados. HTTP público mantém limitação de confidencialidade já documentada. |
| Catálogo sem custo/margem | `src/server/shop.ts:44–50`; `docs/evidence/aws-http-security.json` | Lista pública omite os campos internos; evidência AWS confirmou 12 produtos e ausência desses campos. |
| TLS PostgreSQL | `src/server/db.ts:12–16`; `docs/evidence/aws-worker-verification.json` | Validação da CA configurada; smoke test remoto do worker mostrou conexão TLS. |

## Evidências reais analisadas

- `docs/evidence/reservations.tap`: 16 testes focados locais aprovados; isso não equivale a repetir os cenários na AWS.
- `docs/evidence/http.tap`, `http-docker.tap` e `http-alb-compatibility.tap`: quatro testes HTTP por execução, com ambientes e objetivos diferentes; não contar como 12 cenários distintos.
- `docs/evidence/aws-real-chat.json`: resposta progressiva do Luna real, consulta/recomendação baseada no catálogo e persistência da conversa.
- `docs/evidence/aws-real-journey.json`: proposta persistida, pedido de 20% resultando em contraproposta menor, tentativa de 90% sem confirmação pelo chat e confirmação explícita idempotente. Uma defesa bem-sucedida contra uma tentativa adversarial não prova ausência de jailbreak.
- `docs/evidence/aws-stock-concurrency.json`: disputa por estoque, rejeição 409, proibição de cancelamento entre sessões e liberação/restauração do estoque.
- `docs/evidence/aws-http-security.json`: 401 sem sessão, 403 para origem externa, 400 para preço forjado, catálogo sem campos internos e compatibilidade CSP/HTTP.
- `docs/evidence/aws-dlq-retries.json`, `aws-dlq-message.json`, `aws-dlq-alarm.json` e `aws-dlq-alarm-action.json`: retentativas, encaminhamento e acionamento real de alarme/publicação SNS.
- `docs/evidence/aws-load-catalog-50.json`: 2.712 respostas HTTP 200, 24 falhas de rede, p95 aproximadamente 660 ms e p99 aproximadamente 5,34 s. Esse teste coincidiu com trocas de tasks e não mede IA nem confirmação. Não comprova operação sem falhas; o diagnóstico das falhas e uma medição estável são pendências.

## Incidente da prévia local e limites desta revisão

O usuário reportou `Failed to fetch` ao clicar em adicionar produto na prévia `http://localhost:5187/`. O agente principal assumiu a reprodução e o diagnóstico, concluídos posteriormente conforme o adendo. Na leitura inicial, não foi atribuída causa por inferência: o frontend envia chamadas relativas `/api/...` em [main.tsx:79](/Users/soria/Documents/Codex/2026-11-12/c/outputs/periferia/apps/web/src/main.tsx:79), e o Vite encaminha `/api` para a porta 3187 em [vite.config.mts:10](/Users/soria/Documents/Codex/2026-11-12/c/outputs/periferia/apps/web/vite.config.mts:10). Um erro de rede exige conferir servidor, proxy, HTTP e navegador; ler esses caminhos não comprova a causa.

Os testes de aplicação oferecem evidência sólida do MVP e das invariantes principais de estoque. Ainda não permitem afirmar que todas as decisões comerciais foram cumpridas nem que a aplicação alcançou robustez A+. O avaliador deve considerar os achados acima, o incidente local e as evidências de resiliência/carga que forem concluídas após esta revisão. Terraform e portabilidade São Paulo pertencem à dimensão final do projeto e precisam de avaliação separada.

## Adendo — correções autorizadas e validadas localmente

Após a entrega dos achados, o agente principal autorizou a implementação dos itens 1, 2 e 3. Esses três achados descrevem a versão anterior à correção; não devem ser apresentados como defeitos ainda presentes no código corrigido. As referências de linha das seções históricas correspondem à leitura inicial. As posições atuais relevantes são as seguintes:

| Correção | Código atual | Validação focada |
| --- | --- | --- |
| Novas concessões abaixo do pedido em todas as rodadas, com teto de 20% | [shop.ts:169](/Users/soria/Documents/Codex/2026-11-12/c/outputs/periferia/src/server/shop.ts:169) | Pedidos de 3%, 5%, 6% e 20% nas rodadas 1, 2, 7 e 8 permanecem abaixo do pedido. Pedido de 90% pode alcançar o teto de 20%. |
| Oferta válida anterior não é piorada nem renovada sem nova concessão | [shop.ts:172](/Users/soria/Documents/Codex/2026-11-12/c/outputs/periferia/src/server/shop.ts:172) | Uma oferta válida de 5% é preservada, com mesmo ID e prazo, se o cliente pedir 5% novamente. Preservar a oferta anterior não é aceitar uma nova concessão. |
| Recuperação real da IA antes de reabrir operações | [ai.ts:118](/Users/soria/Documents/Codex/2026-11-12/c/outputs/periferia/src/server/ai.ts:118) | Lease de 30 segundos por atualização condicional de `Dependency.failedUntil`; apenas uma réplica executa o probe, inclusive quando ambas leram a mesma falha vencida. |
| Probe sem ferramentas ou dados comerciais | [ai.ts:147](/Users/soria/Documents/Codex/2026-11-12/c/outputs/periferia/src/server/ai.ts:147) | SDK Responses chamado com entrada fixa, sem tools, `store:false`, raciocínio desativado e saída limitada a 16 tokens. Teste usa transporte substituído em memória, sem rede. Resposta incompleta, mesmo com HTTP 200, mantém o bloqueio. |
| Sucesso antigo não apaga falha mais recente | [ai.ts:131](/Users/soria/Documents/Codex/2026-11-12/c/outputs/periferia/src/server/ai.ts:131) | A limpeza do probe depende da lease correspondente. O sucesso normal do chat também deixou de limpar incondicionalmente o gate de outra réplica. |
| Todas as reservas ativas visíveis e canceláveis | [shop.ts:73](/Users/soria/Documents/Codex/2026-11-12/c/outputs/periferia/src/server/shop.ts:73) | Estado testado com 35 reservas ativas antigas e 35 finalizadas recentes: retorna todas as 35 ativas e somente as 30 últimas finalizadas, sem expor sessionId/requestKey. |

Arquivo dos testes: [audit-regressions.test.ts](/Users/soria/Documents/Codex/2026-11-12/c/outputs/periferia/src/test/audit-regressions.test.ts).

Foi executado o ciclo red/green: os testes de negociação, disponibilidade e truncamento reproduziram as regressões antes da correção; depois, os 11 testes focados passaram. O primeiro ensaio de transporte por servidor HTTP local também encontrou uma restrição `EPERM` de bind do sandbox, que não era defeito da aplicação. Esse teste foi substituído por interceptação de `fetch` no processo isolado, preservando o exercício do SDK real e eliminando acesso à rede. O typecheck de backend (`tsc --noEmit -p tsconfig.json`) passou depois das alterações. Nenhuma suíte completa foi executada.

Comando de reprodução, na raiz do projeto, com Node.js 24 no PATH:

```sh
node --import tsx --test --test-reporter=tap src/test/audit-regressions.test.ts
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
```

O patch não introduz migrations, não muda o contrato das ferramentas e não modifica o frontend. Os dois critérios comerciais continuam interpretados pela IA conforme o prompt, com limite financeiro garantido pelo backend. O cooldown deixa de ser tratado como recuperação presumida, mas continua não havendo garantia de descobrir uma falha externa antes da primeira chamada que a manifeste.

Segundo a confirmação do agente principal, o `Failed to fetch` local decorreu de servidores de desenvolvimento parados. Vite e API foram reiniciados, e o clique em adicionar teclado passou a mostrar um item. Essa confirmação resolve o incidente local relatado; não foi obtida por uma alteração de frontend deste auditor.

Limitações restantes: a correção foi validada no código-fonte local e em testes isolados. Este auditor não construiu imagem, publicou ou implantou na AWS, nem acionou um probe real com a chave do usuário. O agente principal deve revisar o patch, construir/implantar e registrar uma verificação de integração após a implantação. O achado de observabilidade do item 4 não foi corrigido neste patch.

## Atualização posterior à auditoria

O relatório acima preserva o corte e as conclusões do auditor. A coleta posterior e as correções implantadas constam em `estado.md` e `avaliacao-rubrica.md`. A v3 foi implantada nas task definitions revisão 2; a repetição de carga teve 2.400 respostas HTTP 200 sem falhas. Esta atualização documental do executor não altera retroativamente os achados da auditoria.
