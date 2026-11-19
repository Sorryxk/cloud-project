# Avaliação independente da etapa automática

**Reavaliação encerrada em 19/11/2026, corte de 17:57 UTC.** Foram conferidos o PDF original, o código e as evidências de `docs/evidence/final-20261119/`, preservando os resultados anteriores. Este avaliador não alterou AWS ou código, não executou Terraform nem a suíte completa, não leu o diretório operacional privado ou valores de segredos.

## Parecer

**A dimensão 7 mantém B comprovado, com avanços concretos nos requisitos de A e A+.** São Paulo foi destruído e reconstruído de uma cópia limpa do código, usando um diretório operacional novo e estado remoto preservado. O novo ambiente funciona com Bedrock real e recursos regionais próprios. A ausência de dependência da infraestrutura manual de Ohio está substancialmente melhor demonstrada.

**A integral ainda não está comprovado de forma conservadora:** a primeira destruição falhou por perda antecipada da conectividade dos agentes ECS; foi necessário recompor rede temporariamente fora do Terraform e retomar a exclusão. A correção de dependências foi incorporada ao código, mas ainda não foi submetida a outro ciclo completo de destruição. A+ é cumulativo e não se sustenta enquanto essa lacuna de A permanecer.

A recuperação foi autorizada e removida ao fim. Portanto, não se afirma violação da regra sobre intervenções não autorizadas. A ressalva é de **reprodutibilidade do fluxo corrigido**, e não de falta de autorização ou de inexistência do ambiente reconstruído. Este parecer não determina a nota do professor nem calcula média entre dimensões: o PDF não fornece pesos ou fórmula global.

## Confronto com a rubrica

| Nível | Situação neste corte | Evidência e limite |
| --- | --- | --- |
| C | Superado | Terraform cobre a infraestrutura completa, e o ambiente funcional foi observado na região solicitada. |
| B | **Comprovado** | Infraestrutura nova em `sa-east-1`, código parametrizado/versionado, estado remoto, imagens e endpoints regionais, jornada persistente real sem recursos de runtime de Ohio. |
| A | **Parcialmente comprovado** | AMI/AZ/imagem/endpoints regionais corretos; criação limpa e destruição com retomada concluídas. Falta validar a destruição corrigida sem reparo de rede fora do fluxo entregue. |
| A+ | **Não comprovado integralmente** | Módulo reutilizável, bootstrap remoto recuperável e criação de cópia limpa fortalecem portabilidade e independência. A lacuna cumulativa de A impede atribuição integral de A+. |

O PDF, página 6, exige para A que criação e destruição sejam reproduzíveis; para A+, acrescenta qualidade, reutilização, portabilidade e ausência de dependências ocultas de Ohio. Um `plan` sem mudanças confirma convergência, mas não exercita a ordem inversa de remoção dos recursos.

## O ciclo realmente executado

| Marco | Resultado conferido |
| --- | --- |
| Revisão/autorização | Escopo `periferia-sp/sa-east-1`, plano inicial de **103 deleções**; backend e Ohio preservados. [Plano](evidence/final-20261119/sp-destroy-review.json). |
| Primeira destruição | Começou 17:01:33, terminou 17:21:51, **exit 1**, código `dcbdf5b8…`. [Execução](evidence/final-20261119/sp-destroy-execution.json). |
| Diagnóstico e recuperação | Rotas/regras removidas antes do STOP; agentes desconectados, tasks sem encerrar. Rede temporária restabelecida, depois removida às 17:27:57. [Recuperação](evidence/final-20261119/sp-teardown-recovery.json). |
| Retomada | **57 recursos restantes**, concluída 17:34:06 com **exit 0**. [Resultado](evidence/final-20261119/sp-destroy-resume-result.json). |
| Fechamento da remoção | VPC antiga ausente; **zero recursos gerenciados no estado da aplicação antes da recriação**; snapshot final `available`; bucket versionado e Ohio saudável preservados; rede de recuperação removida. [Fechamento](evidence/final-20261119/sp-destroy-closure.json). |
| Reconstrução | Código limpo **9f31818**, diretório operacional novo, recuperação do bootstrap/backend previstos. Infraestrutura, imagem regional, credenciais, migration, probe Bedrock e ativação concluídos. [Progresso](evidence/final-20261119/sp-recreated-progress.json). |
| Novo ambiente | VPC `vpc-004a279b92208557b`, origem `http://periferia-sp-1704839089.sa-east-1.elb.amazonaws.com`, banco/fila/ECR/cluster próprios. [Deployment](evidence/final-20261119/sp-recreated-deployment.json). |
| Atualização funcional posterior | Correção de formatação do chat **0af314f**, digest `sha256:9c4919a8a8b8ed385f342178dbafa2be32246071338e25da8d818dc406a2b237`, implantada nos dois ambientes. [Rollout SP](evidence/final-20261119/chat-format-sp-rollout.json). |

A remoção preservou intencionalmente bucket de estado, versões e snapshot final; não foi uma exclusão de todo artefato da conta. Esses itens de retenção não são recursos ocultos do runtime antigo.

## Fonte e contrato de implantação conferidos

- **Módulo e recursos regionais:** [main.tf:1](../infra/terraform/main.tf) instancia a plataforma; [variables.tf:15](../infra/terraform/modules/platform/variables.tf) consulta AZs e AMI ECS/AL2023 no SSM regional; imagem por digest e origem do ALB vêm dos recursos novos em [variables.tf:19](../infra/terraform/modules/platform/variables.tf).
- **ECS/EC2:** [ecs.tf:42](../infra/terraform/modules/platform/ecs.tf) define ASG/limites; [ecs.tf:67](../infra/terraform/modules/platform/ecs.tf) inclui as novas dependências que preservam rotas, regras e perfil do host durante a saída. Essa correção trata a causa encontrada; leitura do grafo não substitui novo destroy real.
- **Contenção do processo:** [ecs.tf:120](../infra/terraform/modules/platform/ecs.tf) configura filesystem somente leitura para API/worker, remoção de capabilities e `no-new-privileges`. Os testes abaixo verificam o efeito no runtime.
- **IAM:** [iam.tf:22](../infra/terraform/modules/platform/iam.tf) separa execution roles/segredos; [iam.tf:46](../infra/terraform/modules/platform/iam.tf) restringe o worker à fila principal; [iam.tf:53](../infra/terraform/modules/platform/iam.tf) define invocação Bedrock limitada ao modelo/perfil.
- **Bootstrap e implantação:** [deploy-terraform.py:125](../scripts/deploy-terraform.py) prepara o estado; [deploy-terraform.py:213](../scripts/deploy-terraform.py) aplica infraestrutura/capacidade; [deploy-terraform.py:225](../scripts/deploy-terraform.py) publica imagem Linux/amd64 regional; [deploy-terraform.py:244](../scripts/deploy-terraform.py) configura valores de credenciais fora do Terraform; [deploy-terraform.py:255](../scripts/deploy-terraform.py) inicia migration/grants e [deploy-terraform.py:280](../scripts/deploy-terraform.py) valida Bedrock com a role real antes da ativação.

A entrega usa **Terraform e o deployer operacional versionado**, com credenciais temporárias da AWS, Docker/buildx e ferramentas documentadas. O script não executa `destroy`; a remoção deliberada e suas proteções estão descritas no [README:58](../infra/terraform/README.md). Esse contrato precisa acompanhar a demonstração e não pode ser apresentado como um único `terraform apply` autossuficiente.

O código está versionado localmente. A reconstrução usou **9f31818**; o runtime atual contém a correção **0af314f**. GitHub permanece uma entrega pendente neste corte; o Git local não comprova publicação nem substitui o link solicitado pelo professor.

## Estado remoto e independência de Ohio

O bootstrap e a aplicação usam chaves distintas no S3 com locking nativo, conforme [deploy-terraform.py:140](../scripts/deploy-terraform.py), [state/main.tf:22](../infra/terraform/state/main.tf) e [README:28](../infra/terraform/README.md). A primeira criação do próprio bucket exige estado local transitório e posterior migração; instalações seguintes usam diretamente o estado remoto verificado. A recriação observada usou o bucket preservado, **não ensaiou a primeira criação concorrente de um bucket inexistente**.

A [auditoria posterior à recriação](evidence/final-20261119/sp-recreated-state-security-audit.json) examinou **três segredos/cinco valores em memória**, sem encontrar os valores ou literais de Ohio em nenhum dos dois estados. Confirma versionamento, AES256 e bloqueio público. Isso não atesta todos os logs, estados históricos ou valores possíveis; o lock configurado tampouco equivale a um ensaio concorrente de contenção.

A inferência agora usa Bedrock pela IAM Role, sem chave OpenAI ou leitura de segredo de Ohio. O adaptador em [bedrock.ts:23](../src/server/bedrock.ts) deriva o endpoint da região e restringe destino/método em [bedrock.ts:37](../src/server/bedrock.ts). O SDK OpenAI é apenas cliente do protocolo Responses; não demonstra uso de `api.openai.com`.

O perfil global pode encaminhar processamento para outras regiões AWS, como explica o [README:20](../infra/terraform/README.md). Isso é uma característica do serviço gerenciado de IA e não uma dependência do ECR, banco, VPC ou cluster manual de Ohio. Permissão/disponibilidade do modelo na conta e região é pré-requisito explícito; a implantação não aceita termos de Marketplace automaticamente.

A nova VPC, os endpoints regionais, a cópia limpa e o diretório operacional novo oferecem evidência efetiva de independência. A busca por literais nos estados é complementar, não uma prova isolada de ausência de toda dependência oculta.

## Validação funcional da nova infraestrutura

O [snapshot de 17:54:45](evidence/final-20261119/sp-recreated-final-snapshot.json) registra API **1/1**, worker **1/1**, rollouts COMPLETED, ALB saudável, RDS privado/criptografado disponível com backup de sete dias e fila/DLQ vazias. ASG **mínimo 1, desejado 2, máximo 4**, com **duas EC2 saudáveis**; uma sem tasks. Não se deve confundir mínimo configurado com quantidade observada.

A [jornada real](evidence/final-20261119/sp-recreated-real-journey.json) executou **26 passos** com Bedrock, carrinho manual, proposta, confirmação idempotente e cancelamento. O estoque passou de **12 para 11 e voltou a 12**. O [teste isolado de guardrails](evidence/final-20261119/sp-recreated-guardrails-http.json) aprovou oito negativos e preservou cinco invariantes.

O [primeiro teste de negativos](evidence/final-20261119/sp-recreated-guardrails-during-journey.json) coincidiu com a reserva positiva: as rejeições passaram, mas a disponibilidade pública mudou. A repetição isolada resolveu a interferência. O resultado inicial foi preservado; não se transforma essa colisão em falha comprovada do produto nem se omite o teste que falhou.

Os runtimes da [API](evidence/final-20261119/sp-recreated-api-runtime.json) e do [worker](evidence/final-20261119/sp-recreated-worker-runtime.json) registram UID 1000, TLS no PostgreSQL, papéis próprios, escrita de preço negada, IMDS bloqueado, `CapEff=0`, `CapBnd=0` e `NoNewPrivs=1`. O worker confirma fila regional. A [verificação Bedrock](evidence/final-20261119/sp-recreated-bedrock-probe.json) usa a role da API. O [novo plan](evidence/final-20261119/sp-recreated-noop.txt) termina em `No changes` e libera o lock.

**Smoke visual/interativo em SP ainda pendente:** o navegador interno bloqueou a nova origem HTTP com `ERR_BLOCKED_BY_CLIENT`. Ohio teve a formatação conferida visualmente. HTTP/jornada/API funcionais não comprovam que os cliques foram observados no navegador de São Paulo.

## Lacunas para A e A+

1. **Para A na dimensão 7:** executar, somente com autorização específica, outro ciclo completo usando a correção entregue em `ecs.tf:67–80`, sem recompor rede fora do Terraform. Registrar plano/destino, resultado da remoção, retenções, estado vazio, reconstrução limpa, jornada, auditoria e no-op. O ciclo anterior permanece como prova de recuperação e criação, com falha inicial explícita.
2. **Para A+ nessa dimensão:** além de fechar A, consolidar um procedimento de teardown reutilizável, tratamento das proteções e recuperação, versões/configurações e independência do diretório operacional antigo. A reconstrução já realizada fecha boa parte da dúvida sobre dependências ocultas de Ohio; não é necessário inventar uma terceira região obrigatória.
3. **Para entregar o trabalho:** finalizar relatório/pacote, publicar GitHub na visibilidade autorizada e gravar o vídeo com link separado, conforme complemento do professor. O material deve demonstrar o que foi realmente executado, incluindo recuperação, sem narrar o primeiro destroy como bem-sucedido.
4. **Para alegar A+ no projeto inteiro:** fechar os limites de segurança, capacidade e rastreabilidade do [parecer geral](avaliacao-rubrica.md). Concluir os cliques SP e distinguir testes históricos de Ohio de ensaios no runtime Bedrock atual.

O [scan da imagem atual em SP](evidence/final-20261119/chat-format-image-scan-sa-east-1.json) registra **6 HIGH, 11 MEDIUM e 4 LOW**, também reportados em Ohio. A mudança de contagem/digest em relação a imagens anteriores não demonstra, por si só, correção dos achados. HTTP público, mínimo econômico 1, RDS Single-AZ e ausência de destinatário externo SNS continuam limites que Terraform não elimina. Nem RDS Multi-AZ, CI/CD ou cinquenta usuários com IA são requisitos literais do PDF.

Revisão de português concluída. Apenas este parecer e `docs/avaliacao-rubrica.md` foram alterados por este avaliador.
