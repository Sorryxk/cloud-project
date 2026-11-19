# Periferia: guia da entrega acadêmica

**Status em 19/11/2026: preparação da entrega; fechamento ainda pendente.** Bedrock validado pela role real da API e pela jornada da loja em Ohio e São Paulo. Permissões legadas da chave OpenAI foram retiradas; o segredo legado de São Paulo foi removido do Terraform. A destruição/recriação autorizada e o novo parecer final ainda não foram executados. A sessão administrativa voltou a expirar durante o intervalo; a tentativa de preparação parou antes de alterar recursos. Não apresentar este corte como projeto final concluído.

## O que apresentar

O roteiro exige a aplicação funcionando em Ohio e São Paulo, diagrama e inventário da etapa manual, código Terraform organizado/versionado/parametrizado com estado remoto e demonstrações de MVP, elasticidade, substituição de componentes, persistência e criação completa em São Paulo. Não especifica plataforma de envio, prazo, duração, slides ou vídeo obrigatório. As instruções complementares do professor prevalecem sobre as recomendações de formato deste guia.

## Ordem de leitura

| Material | Onde encontrar | Finalidade |
| --- | --- | --- |
| Execução da aplicação | [README](README.md) | Rodar localmente e entender o MVP |
| Decisões comerciais e técnicas | [Decisões](docs/decisoes.md) | Explicar limites, estoque, reservas e dimensionamento |
| Arquitetura e etapa manual | [Ohio](docs/aws-manual.md) e [inventário](docs/aws-inventory.json) | Diagrama, recursos e procedimento sem IaC |
| Reconstrução regional | [Guia Terraform](infra/terraform/README.md) e [relatório SP](docs/terraform-sp.md) | Criar um ambiente novo a partir do código |
| Remoção e recriação | [Procedimento SP](docs/recriar-sao-paulo.md) | Planos, escopo, snapshot e validação da reconstrução |
| IA na AWS | [Bedrock](docs/bedrock.md) | Modelo, endpoint, IAM e limites regionais |
| Requisitos e evidências | [Matriz do roteiro](docs/roteiro.md) | Localizar a prova correspondente a cada critério |
| Ensaios de infraestrutura | [Resultados manuais](docs/ensaios-manual-fase2.md) | Carga, drenagem, worker e outbox; preservar os limites de cada teste |
| Operação e segurança | [Runbook](docs/operacao-incidentes.md), [capacidade](docs/analise-capacidade-seguranca.md) e [imagem](docs/triagem-imagem.md) | Diagnóstico e riscos residuais |
| Avaliação | [Manual](docs/avaliacao-rubrica.md) e [Terraform](docs/avaliacao-terraform.md) | Pareceres históricos; novo parecer final ainda pendente |
| Apresentação | [Roteiro de demonstração](docs/apresentacao.md) | Sequência prática para defender o trabalho |
| Gravação | [Plano de vídeo](docs/gravar-entrega.md) | Telas, capítulos, narração e conferência antes de gravar |

## Evidências mais recentes

`docs/evidence/final-20261119/ohio-real-journey.json`: jornada Bedrock real com estado persistido, contraproposta, tentativa de 90% sem confirmação automática, reserva idempotente, prazo de 900 segundos e cancelamento. `ohio-guardrails-http.json`: oito negativos e cinco invariantes preservados. `focused-tests.tap`: 17 testes focados aprovados; não é uma execução da suíte completa.

Os diretórios com datas anteriores preservam o provedor e o ambiente usados em cada ensaio. A coleta inicial de 19/11 com erro na grafia esperada de CANCELLED foi preservada separadamente; a repetição corrigida passou. Testes de catálogo não equivalem a carga de conversas com IA. O mínimo de uma réplica não recebe a tolerância a falhas do perfil ensaiado com duas réplicas. Resultados de Ohio não são automaticamente resultados de São Paulo.

## Gerar e conferir o pacote

Após fechar a implantação, atualizar os relatórios, revisar segredos e registrar a versão em Git:

```sh
python3 scripts/package-delivery.py /caminho/fora/do/projeto/entrega-final
```

O script exige checkout limpo e produz código/documentação/evidências em `periferia-source.zip`, histórico offline em `periferia-history.bundle` e hashes em `manifest.json`. Para recuperar o histórico: `git clone periferia-history.bundle periferia`. O ZIP e o bundle devem corresponder ao commit registrado no manifesto.

Entregar um link de repositório acessível ao professor ou o pacote conforme o canal da disciplina. Não enviar o diretório operacional, credenciais, cookies, `.env`, tfvars privados, planos ou estados Terraform. Os segredos permanecem na conta AWS; outro operador precisa de sua própria sessão autorizada.

O ZIP antigo de 16/11 não contém a versão Bedrock e não é a entrega final. Este guia e a avaliação devem ser atualizados após a reconstrução real de São Paulo.
