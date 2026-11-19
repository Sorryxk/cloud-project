# Periferia: guia da entrega acadêmica

**Status em 19/11/2026: preparação da entrega; fechamento ainda pendente.** Bedrock validado pela role real da API nos dois ambientes. São Paulo foi removido e recriado a partir do código versionado, com snapshot final do banco anterior e preservação de Ohio e do bucket de estado. A primeira remoção exigiu recuperação temporária da conectividade e retomada após timeout; os registros foram preservados. A nova instalação passou na jornada HTTP, nos negativos isolados, no runtime e na auditoria de estado, com plano sem diferenças. O smoke visual de São Paulo foi concluído no Safari, incluindo carrinho, resumo, confirmação e cancelamento; o navegador interno continua bloqueando a origem. O relatório técnico foi gerado e conferido em seis páginas; os pareceres foram atualizados, sem atribuição integral de A+. Faltam publicação do GitHub e gravação/hospedagem do vídeo.

## O que apresentar

O roteiro exige a aplicação funcionando em Ohio e São Paulo, diagrama e inventário da etapa manual, código Terraform organizado/versionado/parametrizado com estado remoto e demonstrações de MVP, elasticidade, substituição de componentes, persistência e criação completa em São Paulo. O PDF não especifica o formato do envio. A orientação complementar do professor exige três itens: **link do vídeo de apresentação, link do GitHub e documentação (relatório)**. **O link do vídeo deve ser entregue separado da documentação.** Duração e plataforma de hospedagem do vídeo não foram definidas pelo professor.

## Ordem de leitura

| Material | Onde encontrar | Finalidade |
| --- | --- | --- |
| Relatório técnico | [PDF de seis páginas](output/pdf/relatorio-tecnico.pdf) | Documento preparado para a entrega, com arquitetura, testes e limitações |
| Execução da aplicação | [README](README.md) | Rodar localmente e entender o MVP |
| Decisões comerciais e técnicas | [Decisões](docs/decisoes.md) | Explicar limites, estoque, reservas e dimensionamento |
| Arquitetura e etapa manual | [Ohio](docs/aws-manual.md) e [inventário](docs/aws-inventory.json) | Diagrama, recursos e procedimento sem IaC |
| Reconstrução regional | [Guia Terraform](infra/terraform/README.md) e [relatório SP](docs/terraform-sp.md) | Criar um ambiente novo a partir do código |
| Remoção e recriação | [Procedimento SP](docs/recriar-sao-paulo.md) | Planos, escopo, snapshot e validação da reconstrução |
| IA na AWS | [Bedrock](docs/bedrock.md) | Modelo, endpoint, IAM e limites regionais |
| Requisitos e evidências | [Matriz do roteiro](docs/roteiro.md) | Localizar a prova correspondente a cada critério |
| Ensaios de infraestrutura | [Resultados manuais](docs/ensaios-manual-fase2.md) | Carga, drenagem, worker e outbox; preservar os limites de cada teste |
| Operação e segurança | [Runbook](docs/operacao-incidentes.md), [capacidade](docs/analise-capacidade-seguranca.md) e [imagem](docs/triagem-imagem.md) | Diagnóstico e riscos residuais |
| Avaliação | [Manual](docs/avaliacao-rubrica.md) e [Terraform](docs/avaliacao-terraform.md) | Reavaliação de 19/11: Ohio predominantemente A, segurança B; dimensão 7 B comprovado, com avanços parciais de A |
| Apresentação | [Roteiro de demonstração](docs/apresentacao.md) | Sequência prática para defender o trabalho |
| Gravação | [Plano de vídeo](docs/gravar-entrega.md) | Telas, capítulos, narração e conferência antes de gravar |

## Evidências mais recentes

`docs/evidence/final-20261119/ohio-real-journey.json`: jornada Bedrock real com estado persistido, contraproposta, tentativa de 90% sem confirmação automática, reserva idempotente, prazo de 900 segundos e cancelamento. `ohio-guardrails-http.json`: oito negativos e cinco invariantes preservados. `focused-tests.tap`: 17 testes focados aprovados; não é uma execução da suíte completa.

`sp-recreated-real-journey.json`: 26 etapas, incluindo carrinho manual e estoque 12 para 11 e retorno a 12. `sp-recreated-guardrails-http.json`: oito negativos e cinco invariantes na execução isolada. `sp-recreated-api-runtime.json`, `sp-recreated-worker-runtime.json`, `sp-recreated-state-security-audit.json` e `sp-recreated-noop.txt` fecham as verificações de runtime, estado e convergência. `closure.json` registra o ciclo com recuperação e o limite do navegador. As duas regiões usam a correção de formatação do chat do commit `0af314f`.

O relatório pode ser regenerado com `python3 scripts/build-report.py` (requer `reportlab`). A opção `--font-dir` aceita um diretório com `LiberationSans-Regular.ttf` e `LiberationSans-Bold.ttf` para incorporar as fontes; sem ela, usa Helvetica padrão do PDF.

Os diretórios com datas anteriores preservam o provedor e o ambiente usados em cada ensaio. A coleta inicial de 19/11 com erro na grafia esperada de CANCELLED foi preservada separadamente; a repetição corrigida passou. Testes de catálogo não equivalem a carga de conversas com IA. O mínimo de uma réplica não recebe a tolerância a falhas do perfil ensaiado com duas réplicas. Resultados de Ohio não são automaticamente resultados de São Paulo.

## Gerar e conferir o pacote

Após fechar a implantação, atualizar os relatórios, revisar segredos e registrar a versão em Git:

```sh
python3 scripts/package-delivery.py /caminho/fora/do/projeto/entrega-final
```

O script exige checkout limpo e produz código/documentação/evidências em `periferia-source.zip`, histórico offline em `periferia-history.bundle` e hashes em `manifest.json`. Para recuperar o histórico: `git clone periferia-history.bundle periferia`. O ZIP e o bundle devem corresponder ao commit registrado no manifesto.

Entregar o link do vídeo em campo ou arquivo separado, o link do GitHub acessível ao professor e o relatório. Não colocar o link do vídeo dentro do relatório como única forma de acesso. O pacote de código é complementar e não substitui o link do GitHub solicitado. Não enviar o diretório operacional, credenciais, cookies, `.env`, tfvars privados, planos ou estados Terraform. Os segredos permanecem na conta AWS; outro operador precisa de sua própria sessão autorizada.

O ZIP antigo de 16/11 não contém a versão Bedrock e não é a entrega final. Este guia e a avaliação devem ser atualizados após a reconstrução real de São Paulo.
