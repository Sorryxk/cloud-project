# Luna no Amazon Bedrock

Decisão de 18/11/2026: usar o modelo OpenAI GPT‑6 Luna pelo Amazon Bedrock nos dois módulos, manual (Ohio) e automático (São Paulo). A migração substitui a API direta OpenAI e sua chave. O SDK OpenAI permanece apenas como cliente do protocolo Responses; o endpoint de inferência e a autenticação são da AWS.

Configuração: `AI_MODE=bedrock`, `AWS_REGION` do ambiente e `BEDROCK_MODEL_ID=global.openai.gpt-6-luna`. O endpoint é `https://bedrock-runtime.{region}.amazonaws.com/openai/v1/responses`, assinado com SigV4, serviço `bedrock`. Credenciais temporárias são obtidas da role da task e renovadas pela cadeia padrão do SDK. Redirecionamentos e hosts alternativos são bloqueados. Não há chave OpenAI injetada na API nova.

Apenas a task API recebe autorização de invocação do perfil Luna, projeto padrão e foundation model condicionado ao perfil. Worker e bootstrap têm roles separadas. Nenhuma permissão Marketplace é concedida às tasks. O perfil global pode encaminhar a inferência para outras regiões AWS; isso não depende dos recursos da nossa loja em Ohio. Usamos dados fictícios no projeto.

Preços, estoque, margem, teto de desconto de 20%, confirmação explícita e reservas continuam validados pelo backend. Trocar o provedor não transfere essas decisões ao modelo. Falhas de inferência mantêm o mecanismo de bloqueio e recuperação compartilhado entre réplicas. Métricas adicionais registram latência e tokens, sem conteúdo de conversa ou credenciais.

## Verificação

As primeiras chamadas assinadas e os testes de streaming com ferramentas passaram nas duas regiões. `docs/evidence/bedrock-20261118/` contém evidências e 14 testes focados aprovados. O resultado administrativo inicial não substitui a validação com a role restrita real da API. Em 19/11, a jornada HTTP de Ohio passou pela API em modo Bedrock, com contraproposta, tentativa de desconto indevido sem confirmação, reserva idempotente e cancelamento. São Paulo também passou na jornada e no probe real de streaming/ferramentas com sua própria role API. A recriação regional continua pendente. Os ensaios administrativos de 18/11 foram complementados por `evidence/final-20261119/sp-bedrock-task-probe.json`, com duas respostas 200 e log de conclusão pela task API. A auditoria IAM atual está em `bedrock-iam-audit.json` no mesmo diretório.

O script `scripts/deploy-terraform.py` não solicita mais chave OpenAI e executa uma task de verificação Bedrock com a role API antes de ativar os serviços. O probe exige streaming, uma chamada de ferramenta, retorno da ferramenta e resposta final OK. O acesso ao modelo precisa estar disponível na conta; o script não aceita termos nem concede permissões de marketplace automaticamente.

Referências oficiais: [modelo GPT‑6 Luna](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-6-luna.html), [Responses API](https://docs.aws.amazon.com/bedrock/latest/userguide/inference-responses-api.html) e [inferência global](https://docs.aws.amazon.com/bedrock/latest/userguide/global-cross-region-inference.html).
