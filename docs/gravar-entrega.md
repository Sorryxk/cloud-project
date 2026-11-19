# Preparação da gravação da entrega

Vídeo de apoio recomendado pela equipe; o PDF não fixa vídeo obrigatório, duração ou canal de envio. Este arquivo é um plano de gravação, não uma gravação já produzida. O vídeo final deve ser feito depois de validar a reconstrução de São Paulo e usar os mesmos commit, URLs e relatórios do pacote entregue.

## Preparar as telas

Abra somente a loja, o diagrama, os serviços ECS, o ASG, os gráficos do CloudWatch e um terminal de demonstração sem credenciais visíveis. Feche o painel Access keys, o Secrets Manager com valores abertos, arquivos `.env`, histórico sensível do terminal e notificações pessoais. Escolha a captura da janela necessária. Faça um trecho curto para conferir som, resolução e legibilidade antes de gravar a apresentação completa.

Organize as evidências por região e data. Identifique as provas históricas de 18/11 e as verificações Bedrock de 19/11. Não apresente um gráfico histórico como execução ao vivo nem um teste administrativo do modelo como prova da role restrita da aplicação.

## Sequência sugerida

| Bloco | Mostrar na tela | O que explicar e comprovar |
| --- | --- | --- |
| Abertura | Título Periferia e diagrama | Loja de periféricos; foco da avaliação é a arquitetura AWS. Ohio é manual e São Paulo é reconstruído por Terraform. |
| Compra conversacional | Loja e conversa real | A IA consulta catálogo/estoque pelas ferramentas. Pedir um teclado, solicitar 20% e mostrar a contraproposta. O backend determina valores e limites. |
| Confirmação e integridade | Resumo, reserva e resultado da API | A conversa não confirma automaticamente; o botão exige confirmação. Repetir a confirmação preserva o mesmo ID. Mostrar prazo de 15 minutos e cancelamento. |
| IA e permissões | Metadados da task e log sanitizado do probe | Amazon Bedrock com GPT-6 Luna; role API, streaming, chamada e retorno de ferramenta. Nenhuma chave OpenAI injetada. Explicar o roteamento do perfil global. |
| Elasticidade | CloudWatch, serviços ECS e ASG | Relacionar requisições às tasks API, backlog aos workers e demanda às EC2. Mostrar subida e descida com horários e quantidades. Identificar os replays sintéticos. |
| Falhas e persistência | Gráficos, eventos e loja | Drenagem ocupada, reposição, conversa/reserva preservadas, repetição idempotente, DLQ e recuperação da outbox. Explicar a janela exata de cada ensaio. |
| Reconstrução regional | Código Terraform, execução e recursos novos | Região, AMI, AZs, ECR regional e backend remoto. Exibir logs do ciclo real de remoção/recriação e depois a loja nova em São Paulo. Preservar a prova de que Ohio e o bucket de estado continuam disponíveis. |
| Operação e fechamento | Runbook, custos e parecer final | Explicar dimensionamento e riscos residuais: mínimo 1, banco Single-AZ, HTTP, vulnerabilidades da imagem e alertas sem destinatário externo. Apresentar o conceito como parecer técnico, não como nota garantida. |

Como referência de organização, os blocos podem caber em aproximadamente 12 a 18 minutos, se o professor não definir outro tempo. A criação de RDS e a espera por métricas podem levar mais tempo: conservar o registro integral e, se usar cortes no vídeo de apresentação, sinalizar os cortes e os horários. Não acelerar ou editar de modo a esconder falhas, etapas manuais ou períodos sem coleta.

## Evidências e arquivos para acompanhar

- Vídeo da apresentação com narração, se esse formato for aceito pelo professor.
- Registro integral da execução Terraform em arquivo, com horários, planos revisados, resultado e validações. Evitar gravar a tela inteira por todo o provisionamento se isso expuser credenciais.
- Resultados JSON/TAP e gráficos, com a região, o cenário e as limitações identificados.
- Código versionado, README de execução, diagrama, inventário, runbook e parecer atualizado.

## Critério para encerrar a gravação

Conferir que as duas lojas abrem, que o modelo e a role correspondem à versão entregue e que as reservas de teste foram canceladas. Verificar se o vídeo está legível e audível, sem credenciais ou dados privados. O pacote precisa ter o mesmo commit indicado no manifesto. O professor deve conseguir localizar cada demonstração e sua evidência sem depender deste chat.
