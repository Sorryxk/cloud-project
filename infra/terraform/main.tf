module "platform" {
  source               = "./modules/platform"
  region               = var.region
  name                 = var.name
  vpc_cidr             = var.vpc_cidr
  application_enabled  = var.application_enabled
  compute_enabled      = var.compute_enabled
  image_digest         = var.image_digest
  deletion_protection  = var.deletion_protection
  allow_image_deletion = var.allow_image_deletion
}
