terraform {
  required_providers {
    aws = { source = "hashicorp/aws", version = ">= 6.71, < 7.0" }
  }
}
variable "region" { type = string }
variable "name" { type = string }
variable "vpc_cidr" { type = string }
variable "application_enabled" { type = bool }
variable "compute_enabled" { type = bool }
variable "image_digest" { type = string }
variable "deletion_protection" { type = bool }
variable "allow_image_deletion" { type = bool }
data "aws_caller_identity" "current" {}
data "aws_availability_zones" "available" { state = "available" }
data "aws_ssm_parameter" "ecs_ami" {
  name = "/aws/service/ecs/optimized-ami/amazon-linux-2023/recommended/image_id"
}
locals {
  zones  = slice(data.aws_availability_zones.available.names, 0, 2)
  image  = var.image_digest == null ? "${aws_ecr_repository.app.repository_url}:pending-bootstrap" : "${aws_ecr_repository.app.repository_url}@${var.image_digest}"
  origin = "http://${aws_lb.app.dns_name}"
}

variable "bedrock_model_id" { type = string }
