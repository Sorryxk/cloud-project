# Procedimento de remoção e recriação de São Paulo

Escopo autorizado: somente `periferia-sp` em `sa-east-1`. Remoção e reconstrução concluídas em 19/11/2026, preservando Ohio e o bucket de estado remoto. A primeira tentativa precisou de recuperação temporária da conectividade dos agentes ECS e retomada após timeout; os registros originais estão em `docs/evidence/final-20261119/`. A rede temporária foi removida, o snapshot final está disponível e a nova instalação passou na jornada HTTP, nos negativos isolados, no runtime e na auditoria de estado, com plano final sem diferenças. O ciclo incluiu intervenção de recuperação; não foi uma remoção inicial sem falhas. A confirmação visual de cliques na nova URL está pendente pelo bloqueio do navegador interno.

## Preparar a remoção

Usar uma sessão AWS temporária válida, confirmar conta/região/nome nos outputs e conservar o diretório operacional privado. Nunca executar a raiz `infra/terraform/state` como alvo de destruição. O bucket tem proteção própria e não faz parte do ambiente da aplicação.

Exemplo a partir da raiz do projeto, com o diretório operacional da implantação escolhida:

```sh
export PERIFERIA_WORK_DIR=/caminho/privado/periferia-deploy
export TF_DATA_DIR="$PERIFERIA_WORK_DIR/terraform-app"
aws sts get-caller-identity
terraform -chdir=infra/terraform output -json deployment

terraform -chdir=infra/terraform plan \
  -var-file="$PERIFERIA_WORK_DIR/deployment.tfvars.json" \
  -var=deletion_protection=false -var=allow_image_deletion=true \
  -out="$PERIFERIA_WORK_DIR/prepare.tfplan"
terraform -chdir=infra/terraform show "$PERIFERIA_WORK_DIR/prepare.tfplan"
```

Revisar o destino e as mudanças. Em ambiente sem outras diferenças, a preparação altera somente as proteções do ALB/RDS e a opção de limpeza do ECR. Investigar qualquer mudança adicional antes de prosseguir. Depois de aprovar o plano concreto no escopo autorizado:

```sh
terraform -chdir=infra/terraform apply "$PERIFERIA_WORK_DIR/prepare.tfplan"
terraform -chdir=infra/terraform plan -destroy \
  -var-file="$PERIFERIA_WORK_DIR/deployment.tfvars.json" \
  -var=deletion_protection=false -var=allow_image_deletion=true \
  -out="$PERIFERIA_WORK_DIR/destroy.tfplan"
terraform -chdir=infra/terraform show "$PERIFERIA_WORK_DIR/destroy.tfplan"
```

A revisão do plano de destruição deve conferir que todos os recursos pertencem ao módulo de São Paulo, inclusive roles e Budget globais com prefixo do ambiente. Não deve haver bucket de estado nem recursos de Ohio. Registrar a quantidade real, o identificador do snapshot final do RDS e a recuperação de sete dias dos segredos de aplicação. O segredo master é administrado pelo RDS e segue o ciclo gerenciado pelo serviço.

```sh
terraform -chdir=infra/terraform apply "$PERIFERIA_WORK_DIR/destroy.tfplan"
terraform -chdir=infra/terraform state list
```

Guardar o resultado real e verificar a retenção do snapshot, a disponibilidade de Ohio e a preservação do bucket. Recursos retidos intencionalmente não equivalem a falha de remoção; devem ser inventariados. Não declarar destruição concluída enquanto ainda houver falhas ou recursos gerenciados pendentes.

## Reconstruir do código versionado

Usar uma cópia limpa do commit entregue e um diretório operacional novo. O script recupera do S3 o estado separado do bootstrap e reconstrói a aplicação a partir do estado principal vazio; não deve receber IDs antigos nem uma chave OpenAI. Não usar `--skip-build` após excluir o ECR.

```sh
python3 scripts/deploy-terraform.py \
  --region sa-east-1 --name periferia-sp \
  --work-dir /caminho/privado/periferia-recriado
```

Aguardar migration/seed/grants, probe Bedrock com streaming/ferramentas pela role API e estabilidade dos serviços. Usar a URL nova retornada pelo deploy. Executar `scripts/verify-deployment.mjs` e `scripts/verify-guardrails.mjs`, inspecionar TLS/IAM/hardening no runtime, conferir segredos fora do state e gerar novo plano sem diferenças com os tfvars do diretório novo. As proteções de exclusão voltam aos padrões habilitados na reconstrução; a limpeza implícita do ECR volta a ficar desabilitada.

Por fim, registrar IDs novos, retenções, saúde, filas, mínimos e máximos; preservar os resultados anteriores com seus cortes; atualizar o parecer da rubrica e o pacote de entrega. A nova criação não restaura automaticamente os dados do snapshot: o procedimento aprovado começa com banco novo e catálogo inicial.
