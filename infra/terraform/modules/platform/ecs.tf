resource "aws_ecs_cluster" "app" {
  name = var.name
  setting {
    name  = "containerInsights"
    value = "enabled"
  }
  depends_on = [aws_cloudwatch_log_group.insights]
}
resource "aws_launch_template" "nodes" {
  name_prefix            = "${var.name}-"
  image_id               = nonsensitive(data.aws_ssm_parameter.ecs_ami.value)
  instance_type          = "t3.small"
  update_default_version = true
  iam_instance_profile { name = aws_iam_instance_profile.nodes.name }
  credit_specification { cpu_credits = "standard" }
  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
    instance_metadata_tags      = "disabled"
  }
  network_interfaces {
    associate_public_ip_address = false
    security_groups             = [aws_security_group.nodes.id]
    delete_on_termination       = true
  }
  block_device_mappings {
    device_name = "/dev/xvda"
    ebs {
      volume_size           = 30
      volume_type           = "gp3"
      encrypted             = true
      delete_on_termination = true
    }
  }
  user_data = base64encode(templatefile("${path.module}/user-data.sh.tftpl", { cluster = aws_ecs_cluster.app.name }))
  tag_specifications {
    resource_type = "instance"
    tags          = { Name = "${var.name}-ecs", Project = "Periferia" }
  }
}
resource "aws_autoscaling_group" "nodes" {
  name                      = "${var.name}-ecs"
  min_size                  = var.compute_enabled ? 1 : 0
  desired_capacity          = var.compute_enabled ? 1 : 0
  max_size                  = 4
  vpc_zone_identifier       = aws_subnet.app[*].id
  health_check_type         = "EC2"
  health_check_grace_period = 180
  protect_from_scale_in     = true
  enabled_metrics           = ["GroupDesiredCapacity", "GroupInServiceInstances", "GroupPendingInstances", "GroupTerminatingInstances", "GroupTotalInstances"]
  launch_template {
    id      = aws_launch_template.nodes.id
    version = aws_launch_template.nodes.latest_version
  }
  tag {
    key                 = "AmazonECSManaged"
    value               = "true"
    propagate_at_launch = true
  }
  tag {
    key                 = "Project"
    value               = "Periferia"
    propagate_at_launch = true
  }
  lifecycle { ignore_changes = [desired_capacity] }
  depends_on = [aws_route.nat, aws_iam_role_policy_attachment.nodes]
}
locals {
  common_environment = {
    NODE_ENV = "production", AWS_REGION = var.region, DATABASE_POOL_MAX = "3", DATABASE_CA_PATH = "/app/certs/global-bundle.pem"
  }
  environment = {
    api       = merge(local.common_environment, { SERVICE_NAME = "api", AI_MODE = "bedrock", BEDROCK_MODEL_ID = var.bedrock_model_id, WEB_ORIGIN = local.origin, TRUST_ALB = "true" })
    worker    = merge(local.common_environment, { SERVICE_NAME = "worker", SQS_QUEUE_URL = aws_sqs_queue.events.url })
    bootstrap = merge(local.common_environment, { SERVICE_NAME = "bootstrap", DB_HOST = aws_db_instance.app.address, SSL_CERT_FILE = "/app/certs/global-bundle.pem", NODE_EXTRA_CA_CERTS = "/app/certs/global-bundle.pem" })
  }
  secrets = {
    api    = [{ name = "DATABASE_URL", valueFrom = "${aws_secretsmanager_secret.app["api-db"].arn}:url::" }]
    worker = [{ name = "DATABASE_URL", valueFrom = "${aws_secretsmanager_secret.app["worker-db"].arn}:url::" }]
    bootstrap = [
      { name = "ADMIN_USERNAME", valueFrom = "${aws_db_instance.app.master_user_secret[0].secret_arn}:username::" },
      { name = "ADMIN_PASSWORD", valueFrom = "${aws_db_instance.app.master_user_secret[0].secret_arn}:password::" },
      { name = "API_DB_PASSWORD", valueFrom = "${aws_secretsmanager_secret.app["api-db"].arn}:password::" },
      { name = "WORKER_DB_PASSWORD", valueFrom = "${aws_secretsmanager_secret.app["worker-db"].arn}:password::" }
    ]
  }
}
resource "aws_ecs_task_definition" "app" {
  for_each                 = toset(["api", "worker", "bootstrap"])
  family                   = "${var.name}-${each.key}"
  network_mode             = "bridge"
  requires_compatibilities = ["EC2"]
  cpu                      = "256"
  execution_role_arn       = aws_iam_role.execution[each.key].arn
  task_role_arn            = aws_iam_role.task[each.key].arn
  runtime_platform {
    cpu_architecture        = "X86_64"
    operating_system_family = "LINUX"
  }
  container_definitions = jsonencode([merge({
    name                   = each.key, image = local.image, essential = true, cpu = 256, memoryReservation = 512, memory = 512
    command                = ["node", each.key == "bootstrap" ? "dist/server/migrate.js" : each.key == "worker" ? "dist/server/worker-main.js" : "dist/server/main.js"]
    portMappings           = each.key == "api" ? [{ containerPort = 3000, hostPort = 0, protocol = "tcp" }] : []
    environment            = [for key, value in local.environment[each.key] : { name = key, value = value }]
    secrets                = local.secrets[each.key]
    readonlyRootFilesystem = each.key != "bootstrap"
    linuxParameters        = { capabilities = { add = [], drop = ["ALL"] } }
    mountPoints            = []
    systemControls         = []
    volumesFrom            = []
    dockerSecurityOptions  = ["no-new-privileges"]
    stopTimeout            = 120
    logConfiguration       = { logDriver = "awslogs", options = { awslogs-group = aws_cloudwatch_log_group.app[each.key].name, awslogs-region = var.region, awslogs-stream-prefix = "ecs" } }
    }, each.key == "bootstrap" ? {} : {
    healthCheck = {
      command     = ["CMD-SHELL", "node -e \"fetch('http://127.0.0.1:${each.key == "api" ? 3000 : 3001}/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\""]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 30
    }
  })])
  depends_on = [aws_iam_role_policy.execution]
}
resource "aws_ecs_service" "app" {
  for_each                           = toset(["api", "worker"])
  name                               = "${var.name}-${each.key}"
  cluster                            = aws_ecs_cluster.app.id
  task_definition                    = aws_ecs_task_definition.app[each.key].arn
  desired_count                      = var.application_enabled ? 1 : 0
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  availability_zone_rebalancing      = "ENABLED"
  health_check_grace_period_seconds  = each.key == "api" ? 60 : null
  capacity_provider_strategy {
    capacity_provider = aws_ecs_capacity_provider.nodes.name
    weight            = 1
    base              = 1
  }
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
  ordered_placement_strategy {
    type  = "spread"
    field = "attribute:ecs.availability-zone"
  }
  ordered_placement_strategy {
    type  = "spread"
    field = "instanceId"
  }
  dynamic "load_balancer" {
    for_each = each.key == "api" ? [1] : []
    content {
      target_group_arn = aws_lb_target_group.api.arn
      container_name   = "api"
      container_port   = 3000
    }
  }
  lifecycle {
    ignore_changes = [desired_count]
    precondition {
      condition     = !var.application_enabled || var.image_digest != null
      error_message = "Publique e fixe a imagem por digest antes de ativar a aplicação."
    }
  }
  depends_on = [aws_ecs_cluster_capacity_providers.app, aws_lb_listener.http, aws_iam_role_policy.worker, aws_iam_role_policy.bedrock]
}
