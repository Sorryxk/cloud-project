variable "region" {
  type    = string
  default = "sa-east-1"
}
variable "name" {
  type    = string
  default = "periferia-sp"
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,19}$", var.name))
    error_message = "Use de 3 a 20 letras minúsculas, números ou hífens."
  }
}
variable "vpc_cidr" {
  type    = string
  default = "10.52.0.0/16"
}
variable "application_enabled" {
  type        = bool
  default     = false
  description = "Ativar somente após publicação da imagem, segredos e bootstrap. O deploy automatiza essa ordem."
}
variable "compute_enabled" {
  type        = bool
  default     = false
  description = "Ativado após o Capacity Provider existir, antes de iniciar o bootstrap."
}
variable "image_digest" {
  type     = string
  default  = null
  nullable = true
  validation {
    condition     = var.image_digest == null || can(regex("^sha256:[a-f0-9]{64}$", var.image_digest))
    error_message = "Informe um digest SHA256 completo, sem tag mutável."
  }
}
variable "deletion_protection" {
  type    = bool
  default = true
}
variable "allow_image_deletion" {
  type        = bool
  default     = false
  description = "Permitir limpeza do repositório somente em uma remoção explicitamente autorizada."
}
