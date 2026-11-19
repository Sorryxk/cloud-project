# Capacidade, eficiência e segurança operacional

Análise em 18/11/2026, somente por leitura de código, configurações, evidências já coletadas e documentação primária. Não altera recursos nem antecipa o resultado dos testes em andamento. A triagem individual dos sete HIGH está em [triagem-imagem.md](triagem-imagem.md).

## Dimensionamento: cabe no scheduler, mas o máximo ainda exige medição

| Ponto | Evidência | Implicação |
| --- | --- | --- |
| Task de API e worker | [`task-api-ohio.json:18`](../infra/aws/task-api-ohio.json) e [`task-worker-ohio.json:18`](../infra/aws/task-worker-ohio.json): CPU 256, memoryReservation 512 MiB, memory 512 MiB; CPU 256 também no nível da task | Cada task tem teto de 0,25 vCPU e 512 MiB. A AWS distingue shares do container e quota da task em EC2; o parâmetro de task estabelece limite por cgroup. [Fonte AWS](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-cpu-memory-error.html). |
| Memória utilizável do host | [`decisoes.md:45`](decisoes.md): ECS registrou 1.657 MiB; [`ecs-user-data.sh:7`](../infra/aws/ecs-user-data.sh): 256 MiB reservados ao host | Três tasks reservam 1.536 MiB, deixando 121 MiB dos recursos registrados sem alocação. Isso é empacotamento por reserva, não medição de pico de RSS ou garantia de ausência de OOM. |
| Máximos configurados | [`decisoes.md:29`](decisoes.md), `evidence/aws-final-scaling-limits.json`: API 6, worker 4, EC2 4 | Dez tasks reservam 5 GiB e até 2,5 vCPU. Quatro hosts oferecem doze slots de memória desse tamanho; três hosts oferecem nove. No máximo de dez tasks, a perda de um host exige reposição para recuperar toda a capacidade, mesmo que a aplicação continue atendendo. Há somente dois slots nominais extras para atualizações, não capacidade para duplicar todos os serviços simultaneamente. |
| Tipo e créditos | [`launch-template.json:3`](../infra/aws/launch-template.json), [`launch-template.json:16`](../infra/aws/launch-template.json): t3.small, créditos standard | A t3.small tem 2 vCPU, baseline de 20% e 24 créditos/h. Isso equivale a aproximadamente 0,4 vCPU sustentado por host sem consumir saldo. Em Standard, saldo esgotado limita o burst; T3 não recebe créditos iniciais de lançamento. [Conceitos EC2](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/burstable-credits-baseline-concepts.html), [modo Standard](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/burstable-performance-instances-standard-mode-concepts.html). |

**Cálculo de risco, não previsão de consumo:** três tasks utilizando integralmente seus tetos podem exigir 0,75 vCPU em um host, acima do baseline de 0,4. Os dez tetos somam 2,5 vCPU, enquanto quatro hosts somam baseline de 1,6 vCPU. Assim, demonstrar que as reservas cabem não comprova desempenho sustentado sem créditos. A carga é parcialmente de espera por banco/IA/rede e pode consumir bem menos; faltam CPUCreditBalance/Usage e testes longos no máximo para decidir se há gargalo real. Reduzir reserva de memória apenas para empacotar mais tasks pode piorar essa relação de CPU; não recomendo fazê-lo sem medir picos.

O modo Standard evita cobrança de créditos excedentes do modo Unlimited, mas troca essa previsibilidade por possibilidade de limitação de CPU. Os arquivos de dashboard/alarmes locais não incluem CPUCreditBalance ou CPUCreditUsage; acrescentar a observação desses sinais ajudaria a sustentar a decisão técnica.

## O que as evidências de 18/11 já permitem afirmar

No recorte de `evidence/manual-validation-20261118/during-load-metrics.json`, o worker apresenta CPU de até 55,83% e memória de até 17,04% **da reserva ECS**. Esses valores não são 55,83% da CPU da EC2 nem pico de memória do host. Com um worker de 0,25 vCPU, 55,83% equivale a aproximadamente 0,14 vCPU. O recorte tem zero em OldestExpirationLag; isso não antecipa a expiração da fixture ainda futura.

O snapshot `infra-latest.json` lido nesta revisão, às 11:43:26 UTC, mostrava API 2/2, worker 1/1 e duas EC2 saudáveis. As tasks originais selecionadas para drenagem estavam STOPPED com motivo explícito de instância em DRAINING. Isso confirma movimentação das tasks naquele ensaio, mas a continuidade HTTP e a escala independente do worker precisam ser concluídas com os arquivos finais. RunningTaskCount igual a 2 durante um deploy/drenagem, isoladamente, não prova scale-out automático.

## Custo: os dois NAT dominam a base

Os preços regionais consultados em 16/11 pelo executor e preservados em `work/aws/prices.json` indicam dois NAT de US$ 0,045/h cada: US$ 65,70 em 730 horas, antes de processamento de dados e IPv4. A base aproximada documentada de US$ 0,1693/h soma uma EC2, RDS, ALB, NAT e quatro IPv4, antes de armazenamento, LCU, logs/métricas, tráfego e expansão. Em 730 horas, essa base dá US$ 123,59; não é uma fatura nem uma atualização de preços feita nesta revisão.

O orçamento de US$ 100 não é compatível com prometer um mês contínuo dessa base sem considerar créditos ou outras condições. O usuário autorizou manter o ambiente ligado. Portanto, a entrega deve registrar a autorização, medir o custo acumulado e comunicar que Budget é alerta, não trava. Não desligar ou remover NAT unilateralmente: são decisões já autorizadas de disponibilidade/custo. A+ exige justificar essa escolha com números, não apenas dizer que duas AZs são melhores.

## Segurança operacional e prioridades para A+

- **HTTP é uma limitação material:** a origem permanece HTTP em [`task-api-ohio.json:63`](../infra/aws/task-api-ohio.json); o cookie só recebe Secure com configuração explícita em [`security.ts:66`](../src/server/security.ts). HttpOnly/SameSite não cifram o token em trânsito. O PDF não obriga domínio/ACM nominalmente, mas não apresentar essa demonstração como proteção completa de sessões. HTTPS com certificado válido e Secure é o próximo incremento quando houver destino apropriado.
- **Imagem:** o scan do manifesto amd64 V3 e o dpkg remoto confirmam os pacotes do sistema reportados. Há correções de alguns CVEs em Trixie, mas não de todos; a troca de base não garante zero HIGH. Há também uma inconsistência de associação CVE/pacote a investigar. Ver a triagem com fontes por CVE.
- **Hardening:** usuário não root, filesystem somente leitura nas tasks de aplicação, IMDSv2/bloqueio de IMDS, papéis DB e IAM separados são controles relevantes já documentados. Para fechar exposição de CVEs locais, registrar capabilities, SUID, PAM/fstab e bibliotecas efetivamente vinculadas no mesmo digest, além de avaliar remover ferramentas desnecessárias do runtime. Não enfraquecer TLS ou ocultar achados do scanner.
- **Critério de conclusão:** manter evidências separadas de escala, falha abrupta, drenagem, persistência e consumo. Medir backlog/idade/tempo de recuperação, latência e erros, CPU/memória/créditos e custo. A primeira carga com falhas não deve ser apagada; o ensaio estável posterior melhora a evidência sem provar retrospectivamente a causa daquelas falhas.

Não atribuí conceito global. A avaliação deve usar os resultados finais dos ensaios, a rubrica cumulativa e o escopo manual, mantendo Terraform/São Paulo como etapa ainda não entregue.
