resource "aws_ecs_capacity_provider" "nodes" {
  name = "${var.name}-ec2"
  auto_scaling_group_provider {
    auto_scaling_group_arn         = aws_autoscaling_group.nodes.arn
    managed_draining               = "ENABLED"
    managed_termination_protection = "ENABLED"
    managed_scaling {
      status                    = "ENABLED"
      target_capacity           = 100
      minimum_scaling_step_size = 1
      maximum_scaling_step_size = 2
      instance_warmup_period    = 120
    }
  }
}
resource "aws_ecs_cluster_capacity_providers" "app" {
  cluster_name       = aws_ecs_cluster.app.name
  capacity_providers = [aws_ecs_capacity_provider.nodes.name]
  default_capacity_provider_strategy {
    capacity_provider = aws_ecs_capacity_provider.nodes.name
    weight            = 1
    base              = 1
  }
}
resource "aws_appautoscaling_target" "service" {
  for_each           = toset(["api", "worker"])
  min_capacity       = var.application_enabled ? 1 : 0
  max_capacity       = each.key == "api" ? 6 : 4
  resource_id        = "service/${aws_ecs_cluster.app.name}/${aws_ecs_service.app[each.key].name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}
resource "aws_appautoscaling_policy" "api" {
  name               = "${var.name}-api-requests"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.service["api"].resource_id
  scalable_dimension = aws_appautoscaling_target.service["api"].scalable_dimension
  service_namespace  = "ecs"
  target_tracking_scaling_policy_configuration {
    target_value       = 300
    scale_out_cooldown = 60
    scale_in_cooldown  = 300
    predefined_metric_specification {
      predefined_metric_type = "ALBRequestCountPerTarget"
      resource_label         = "${aws_lb.app.arn_suffix}/${aws_lb_target_group.api.arn_suffix}"
    }
  }
}
resource "aws_appautoscaling_policy" "worker" {
  name               = "${var.name}-worker-backlog"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.service["worker"].resource_id
  scalable_dimension = aws_appautoscaling_target.service["worker"].scalable_dimension
  service_namespace  = "ecs"
  target_tracking_scaling_policy_configuration {
    target_value       = 10
    scale_out_cooldown = 60
    scale_in_cooldown  = 300
    customized_metric_specification {
      metrics {
        id          = "q"
        return_data = false
        metric_stat {
          stat = "Average"
          metric {
            metric_name = "ApproximateNumberOfMessagesVisible"
            namespace   = "AWS/SQS"
            dimensions {
              name  = "QueueName"
              value = aws_sqs_queue.events.name
            }
          }
        }
      }
      metrics {
        id          = "t"
        return_data = false
        metric_stat {
          stat = "Average"
          metric {
            metric_name = "RunningTaskCount"
            namespace   = "ECS/ContainerInsights"
            dimensions {
              name  = "ClusterName"
              value = aws_ecs_cluster.app.name
            }
            dimensions {
              name  = "ServiceName"
              value = aws_ecs_service.app["worker"].name
            }
          }
        }
      }
      metrics {
        id          = "backlog"
        expression  = "q / t"
        label       = "Mensagens por worker"
        return_data = true
      }
    }
  }
}
