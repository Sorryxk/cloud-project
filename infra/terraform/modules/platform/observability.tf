resource "aws_cloudwatch_log_group" "app" {
  for_each          = toset(["api", "worker", "bootstrap"])
  name              = "/${var.name}/${each.key}"
  retention_in_days = 30
}
resource "aws_cloudwatch_log_group" "insights" {
  name              = "/aws/ecs/containerinsights/${var.name}/performance"
  retention_in_days = 30
}
resource "aws_sns_topic" "alerts" { name = "${var.name}-alertas" }
resource "aws_sns_topic_policy" "alerts" {
  arn = aws_sns_topic.alerts.arn
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Sid = "Owner", Effect = "Allow", Principal = { AWS = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:root" }, Action = ["SNS:GetTopicAttributes", "SNS:SetTopicAttributes", "SNS:AddPermission", "SNS:RemovePermission", "SNS:DeleteTopic", "SNS:Subscribe", "SNS:ListSubscriptionsByTopic", "SNS:Publish"], Resource = aws_sns_topic.alerts.arn },
      { Sid = "Monitoring", Effect = "Allow", Principal = { Service = ["cloudwatch.amazonaws.com", "budgets.amazonaws.com"] }, Action = "SNS:Publish", Resource = aws_sns_topic.alerts.arn, Condition = { StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.current.account_id } } }
    ]
  })
}
locals {
  cluster_dimension = { ClusterName = aws_ecs_cluster.app.name }
  api_dimension     = { ClusterName = aws_ecs_cluster.app.name, ServiceName = "${var.name}-api" }
  worker_dimension  = { ClusterName = aws_ecs_cluster.app.name, ServiceName = "${var.name}-worker" }
  alb_dimension     = { LoadBalancer = aws_lb.app.arn_suffix }
  db_dimension      = { DBInstanceIdentifier = aws_db_instance.app.identifier }
  alarms = {
    chat-falhas             = { ns = "Periferia", metric = "ChatFailures", dims = { Service = "api" }, stat = "Sum", threshold = 0, comparison = "GreaterThanThreshold", periods = 2, missing = "notBreaching" }
    api-sem-tasks           = { ns = "ECS/ContainerInsights", metric = "RunningTaskCount", dims = local.api_dimension, stat = "Minimum", threshold = 1, comparison = "LessThanThreshold", periods = 2, missing = "breaching" }
    worker-sem-tasks        = { ns = "ECS/ContainerInsights", metric = "RunningTaskCount", dims = local.worker_dimension, stat = "Minimum", threshold = 1, comparison = "LessThanThreshold", periods = 2, missing = "breaching" }
    api-memoria             = { ns = "AWS/ECS", metric = "MemoryUtilization", dims = local.api_dimension, stat = "Average", threshold = 80, comparison = "GreaterThanThreshold", periods = 2, missing = "notBreaching" }
    worker-memoria          = { ns = "AWS/ECS", metric = "MemoryUtilization", dims = local.worker_dimension, stat = "Average", threshold = 80, comparison = "GreaterThanThreshold", periods = 2, missing = "notBreaching" }
    cluster-cpu             = { ns = "AWS/ECS", metric = "CPUUtilization", dims = local.cluster_dimension, stat = "Average", threshold = 80, comparison = "GreaterThanThreshold", periods = 3, missing = "notBreaching" }
    alb-5xx                 = { ns = "AWS/ApplicationELB", metric = "HTTPCode_Target_5XX_Count", dims = local.alb_dimension, stat = "Sum", threshold = 5, comparison = "GreaterThanThreshold", periods = 2, missing = "notBreaching" }
    alb-latencia            = { ns = "AWS/ApplicationELB", metric = "TargetResponseTime", dims = local.alb_dimension, stat = "Average", threshold = 2, comparison = "GreaterThanThreshold", periods = 2, missing = "notBreaching" }
    alb-sem-alvos           = { ns = "AWS/ApplicationELB", metric = "HealthyHostCount", dims = { LoadBalancer = aws_lb.app.arn_suffix, TargetGroup = aws_lb_target_group.api.arn_suffix }, stat = "Minimum", threshold = 1, comparison = "LessThanThreshold", periods = 2, missing = "breaching" }
    fila-atraso             = { ns = "AWS/SQS", metric = "ApproximateAgeOfOldestMessage", dims = { QueueName = aws_sqs_queue.events.name }, stat = "Maximum", threshold = 60, comparison = "GreaterThanThreshold", periods = 2, missing = "notBreaching" }
    dlq-mensagens           = { ns = "AWS/SQS", metric = "ApproximateNumberOfMessagesVisible", dims = { QueueName = aws_sqs_queue.dlq.name }, stat = "Maximum", threshold = 0, comparison = "GreaterThanThreshold", periods = 1, missing = "notBreaching" }
    expiracao-atraso        = { ns = "Periferia", metric = "OldestExpirationLag", dims = { Service = "worker" }, stat = "Maximum", threshold = 30, comparison = "GreaterThanThreshold", periods = 2, missing = "notBreaching" }
    worker-falhas           = { ns = "Periferia", metric = "WorkerFailures", dims = { Service = "worker" }, stat = "Sum", threshold = 0, comparison = "GreaterThanThreshold", periods = 2, missing = "notBreaching" }
    outbox-falhas           = { ns = "Periferia", metric = "OutboxFailures", dims = { Service = "worker" }, stat = "Sum", threshold = 0, comparison = "GreaterThanThreshold", periods = 1, missing = "notBreaching" }
    rds-cpu                 = { ns = "AWS/RDS", metric = "CPUUtilization", dims = local.db_dimension, stat = "Average", threshold = 80, comparison = "GreaterThanThreshold", periods = 5, missing = "notBreaching" }
    rds-memoria             = { ns = "AWS/RDS", metric = "FreeableMemory", dims = local.db_dimension, stat = "Minimum", threshold = 104857600, comparison = "LessThanThreshold", periods = 3, missing = "notBreaching" }
    rds-armazenamento       = { ns = "AWS/RDS", metric = "FreeStorageSpace", dims = local.db_dimension, stat = "Minimum", threshold = 2147483648, comparison = "LessThanThreshold", periods = 2, missing = "notBreaching" }
    asg-capacidade-pendente = { ns = "AWS/AutoScaling", metric = "GroupPendingInstances", dims = { AutoScalingGroupName = aws_autoscaling_group.nodes.name }, stat = "Maximum", threshold = 0, comparison = "GreaterThanThreshold", periods = 5, missing = "notBreaching" }
  }
}
resource "aws_cloudwatch_metric_alarm" "app" {
  for_each            = local.alarms
  alarm_name          = "${var.name}-${each.key}"
  alarm_description   = "Consultar docs/operacao-incidentes.md; calibrar com medições do ambiente regional."
  namespace           = each.value.ns
  metric_name         = each.value.metric
  dimensions          = each.value.dims
  statistic           = each.value.stat
  threshold           = each.value.threshold
  comparison_operator = each.value.comparison
  evaluation_periods  = each.value.periods
  datapoints_to_alarm = each.value.periods
  period              = 60
  treat_missing_data  = each.value.missing
  actions_enabled     = var.application_enabled
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}
resource "aws_budgets_budget" "monthly" {
  name         = "${var.name}-100-usd"
  budget_type  = "COST"
  limit_amount = "100"
  limit_unit   = "USD"
  time_unit    = "MONTHLY"
  dynamic "notification" {
    for_each = [25, 50, 75, 90]
    content {
      comparison_operator       = "GREATER_THAN"
      threshold                 = notification.value
      threshold_type            = "PERCENTAGE"
      notification_type         = "ACTUAL"
      subscriber_sns_topic_arns = [aws_sns_topic.alerts.arn]
    }
  }
  notification {
    comparison_operator       = "GREATER_THAN"
    threshold                 = 100
    threshold_type            = "PERCENTAGE"
    notification_type         = "FORECASTED"
    subscriber_sns_topic_arns = [aws_sns_topic.alerts.arn]
  }
  depends_on = [aws_sns_topic_policy.alerts]
}
resource "aws_cloudwatch_dashboard" "app" {
  dashboard_name = var.name
  dashboard_body = jsonencode({ widgets = [
    { type = "metric", x = 0, y = 0, width = 12, height = 6, properties = { region = var.region, title = "API: requisições, latência e falhas", period = 60, metrics = [["AWS/ApplicationELB", "RequestCount", "LoadBalancer", aws_lb.app.arn_suffix, { stat = "Sum" }], ["AWS/ApplicationELB", "TargetResponseTime", "LoadBalancer", aws_lb.app.arn_suffix, { stat = "p95", yAxis = "right" }], ["AWS/ApplicationELB", "HTTPCode_Target_5XX_Count", "LoadBalancer", aws_lb.app.arn_suffix, { stat = "Sum" }]] } },
    { type = "metric", x = 12, y = 0, width = 12, height = 6, properties = { region = var.region, title = "Tasks e capacidade EC2", period = 60, metrics = [["ECS/ContainerInsights", "RunningTaskCount", "ClusterName", aws_ecs_cluster.app.name, "ServiceName", "${var.name}-api"], ["ECS/ContainerInsights", "RunningTaskCount", "ClusterName", aws_ecs_cluster.app.name, "ServiceName", "${var.name}-worker"], ["AWS/AutoScaling", "GroupInServiceInstances", "AutoScalingGroupName", aws_autoscaling_group.nodes.name], ["AWS/AutoScaling", "GroupPendingInstances", "AutoScalingGroupName", aws_autoscaling_group.nodes.name]] } },
    { type = "metric", x = 0, y = 6, width = 12, height = 6, properties = { region = var.region, title = "Mensageria: backlog, idade e DLQ", period = 60, metrics = [["AWS/SQS", "ApproximateNumberOfMessagesVisible", "QueueName", aws_sqs_queue.events.name], ["AWS/SQS", "ApproximateAgeOfOldestMessage", "QueueName", aws_sqs_queue.events.name, { stat = "Maximum", yAxis = "right" }], ["AWS/SQS", "ApproximateNumberOfMessagesVisible", "QueueName", aws_sqs_queue.dlq.name]] } },
    { type = "metric", x = 12, y = 6, width = 12, height = 6, properties = { region = var.region, title = "Outbox e expiração", period = 60, metrics = [["Periferia", "OutboxFailures", "Service", "worker", { stat = "Sum" }], ["Periferia", "OutboxPublished", "Service", "worker", { stat = "Sum" }], ["Periferia", "OldestExpirationLag", "Service", "worker", { stat = "Maximum", yAxis = "right" }]] } },
    { type = "metric", x = 0, y = 12, width = 12, height = 6, properties = { region = var.region, title = "Negócio: reservas e conflitos", period = 60, metrics = [["Periferia", "ReservationsConfirmed", "Service", "api", { stat = "Sum" }], ["Periferia", "ReservationsExpired", "Service", "worker", { stat = "Sum" }], ["Periferia", "StockConflicts", "Service", "api", { stat = "Sum" }]] } },
    { type = "metric", x = 12, y = 12, width = 12, height = 6, properties = { region = var.region, title = "PostgreSQL: CPU e conexões", period = 60, metrics = [["AWS/RDS", "CPUUtilization", "DBInstanceIdentifier", aws_db_instance.app.identifier], ["AWS/RDS", "DatabaseConnections", "DBInstanceIdentifier", aws_db_instance.app.identifier, { yAxis = "right" }]] } }
  ] })
}
