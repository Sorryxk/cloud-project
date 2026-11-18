output "deployment" {
  value = {
    region              = var.region
    name                = var.name
    account_id          = data.aws_caller_identity.current.account_id
    origin              = local.origin
    cluster             = aws_ecs_cluster.app.name
    asg                 = aws_autoscaling_group.nodes.name
    services            = { for key, value in aws_ecs_service.app : key => value.name }
    task_definitions    = { for key, value in aws_ecs_task_definition.app : key => value.arn }
    ecr_url             = aws_ecr_repository.app.repository_url
    ecr_name            = aws_ecr_repository.app.name
    database_host       = aws_db_instance.app.address
    database_id         = aws_db_instance.app.identifier
    secrets             = { for key, value in aws_secretsmanager_secret.app : key => value.arn }
    queue_url           = aws_sqs_queue.events.url
    queue_arn           = aws_sqs_queue.events.arn
    dlq_url             = aws_sqs_queue.dlq.url
    vpc_id              = aws_vpc.app.id
    zones               = local.zones
    ami_id              = nonsensitive(data.aws_ssm_parameter.ecs_ami.value)
    logs                = { for key, value in aws_cloudwatch_log_group.app : key => value.name }
    image_digest        = var.image_digest
    application_enabled = var.application_enabled
    compute_enabled     = var.compute_enabled
  }
}
