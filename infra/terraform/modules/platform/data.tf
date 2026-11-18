resource "aws_db_subnet_group" "app" {
  name       = var.name
  subnet_ids = aws_subnet.db[*].id
}
resource "terraform_data" "identity" {
  triggers_replace = [aws_vpc.app.id]
}
resource "aws_db_instance" "app" {
  identifier                   = "${var.name}-postgres"
  engine                       = "postgres"
  engine_version               = "17"
  instance_class               = "db.t4g.micro"
  allocated_storage            = 20
  max_allocated_storage        = 30
  storage_type                 = "gp3"
  storage_encrypted            = true
  db_name                      = "periferia"
  username                     = "periferia_admin"
  manage_master_user_password  = true
  db_subnet_group_name         = aws_db_subnet_group.app.name
  vpc_security_group_ids       = [aws_security_group.db.id]
  publicly_accessible          = false
  multi_az                     = false
  backup_retention_period      = 7
  deletion_protection          = var.deletion_protection
  skip_final_snapshot          = false
  final_snapshot_identifier    = "${var.name}-final-${substr(terraform_data.identity.id, 0, 8)}"
  copy_tags_to_snapshot        = true
  auto_minor_version_upgrade   = true
  performance_insights_enabled = false
}
resource "aws_secretsmanager_secret" "app" {
  for_each                = toset(["api-db", "worker-db", "openai"])
  name_prefix             = "${var.name}/${each.key}-"
  recovery_window_in_days = 7
}
# Os valores são inseridos pelo bootstrap operacional e nunca entram no state.
# Não adicionar secret_version/data-source com SecretString neste módulo.
resource "aws_sqs_queue" "dlq" {
  name                      = "${var.name}-reservation-dlq"
  sqs_managed_sse_enabled   = true
  message_retention_seconds = 1209600
}
resource "aws_sqs_queue" "events" {
  name                       = "${var.name}-reservation-events"
  sqs_managed_sse_enabled    = true
  visibility_timeout_seconds = 30
  receive_wait_time_seconds  = 10
  message_retention_seconds  = 345600
  redrive_policy             = jsonencode({ deadLetterTargetArn = aws_sqs_queue.dlq.arn, maxReceiveCount = 5 })
}
resource "aws_sqs_queue_redrive_allow_policy" "dlq" {
  queue_url            = aws_sqs_queue.dlq.url
  redrive_allow_policy = jsonencode({ redrivePermission = "byQueue", sourceQueueArns = [aws_sqs_queue.events.arn] })
}
resource "aws_ecr_repository" "app" {
  name                 = "${var.name}/app"
  image_tag_mutability = "IMMUTABLE"
  force_delete         = var.allow_image_deletion
  encryption_configuration { encryption_type = "AES256" }
  image_scanning_configuration { scan_on_push = true }
}
resource "aws_ecr_lifecycle_policy" "app" {
  repository = aws_ecr_repository.app.name
  policy     = jsonencode({ rules = [{ rulePriority = 1, description = "Remover manifests sem tag após 14 dias", selection = { tagStatus = "untagged", countType = "sinceImagePushed", countUnit = "days", countNumber = 14 }, action = { type = "expire" } }] })
}
