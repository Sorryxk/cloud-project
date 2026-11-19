locals {
  task_trust = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Principal = { Service = "ecs-tasks.amazonaws.com" }, Action = "sts:AssumeRole" }] })
  execution_secrets = {
    api       = [aws_secretsmanager_secret.app["api-db"].arn]
    worker    = [aws_secretsmanager_secret.app["worker-db"].arn]
    bootstrap = [aws_db_instance.app.master_user_secret[0].secret_arn, aws_secretsmanager_secret.app["api-db"].arn, aws_secretsmanager_secret.app["worker-db"].arn]
  }
}
resource "aws_iam_role" "nodes" {
  name               = "${var.name}-ec2"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Principal = { Service = "ec2.amazonaws.com" }, Action = "sts:AssumeRole" }] })
}
resource "aws_iam_role_policy_attachment" "nodes" {
  for_each   = toset(["AmazonEC2ContainerServiceforEC2Role", "AmazonSSMManagedInstanceCore"])
  role       = aws_iam_role.nodes.name
  policy_arn = "arn:aws:iam::aws:policy/${each.key == "AmazonEC2ContainerServiceforEC2Role" ? "service-role/" : ""}${each.key}"
}
resource "aws_iam_instance_profile" "nodes" {
  name = "${var.name}-ec2"
  role = aws_iam_role.nodes.name
}
resource "aws_iam_role" "execution" {
  for_each           = toset(["api", "worker", "bootstrap"])
  name               = "${var.name}-${each.key}-execution"
  assume_role_policy = local.task_trust
}
resource "aws_iam_role_policy" "execution" {
  for_each = aws_iam_role.execution
  role     = each.value.id
  name     = "regional-runtime"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["ecr:GetAuthorizationToken"], Resource = "*" },
      { Effect = "Allow", Action = ["ecr:BatchCheckLayerAvailability", "ecr:GetDownloadUrlForLayer", "ecr:BatchGetImage"], Resource = aws_ecr_repository.app.arn },
      { Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = "${aws_cloudwatch_log_group.app[each.key].arn}:*" },
      { Effect = "Allow", Action = ["secretsmanager:GetSecretValue"], Resource = local.execution_secrets[each.key] }
    ]
  })
}
resource "aws_iam_role" "task" {
  for_each           = toset(["api", "worker", "bootstrap"])
  name               = "${var.name}-${each.key}-task"
  assume_role_policy = local.task_trust
}
resource "aws_iam_role_policy" "worker" {
  name   = "reservation-queue-only"
  role   = aws_iam_role.task["worker"].id
  policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Action = ["sqs:SendMessage", "sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:ChangeMessageVisibility", "sqs:GetQueueAttributes"], Resource = aws_sqs_queue.events.arn }] })
}

locals {
  bedrock_profile_arn   = "arn:aws:bedrock:${var.region}:${data.aws_caller_identity.current.account_id}:inference-profile/${var.bedrock_model_id}"
  bedrock_foundation_id = trimprefix(var.bedrock_model_id, "global.")
}
resource "aws_iam_role_policy" "bedrock" {
  name = "luna-bedrock-only"
  role = aws_iam_role.task["api"].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"], Resource = [local.bedrock_profile_arn, "arn:aws:bedrock:${var.region}:${data.aws_caller_identity.current.account_id}:project/default"] },
      { Effect = "Allow", Action = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"], Resource = ["arn:aws:bedrock:${var.region}::foundation-model/${local.bedrock_foundation_id}", "arn:aws:bedrock:::foundation-model/${local.bedrock_foundation_id}"], Condition = { StringEquals = { "bedrock:InferenceProfileArn" = local.bedrock_profile_arn } } },
      { Effect = "Allow", Action = ["bedrock:GetInferenceProfile"], Resource = local.bedrock_profile_arn }
    ]
  })
}
