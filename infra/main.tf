variable "account_id" {
  type      = string
  sensitive = true
}

resource "cloudflare_d1_database" "staging" {
  account_id = var.account_id
  name       = "zemen-staging"

  read_replication = {
    mode = "disabled"
  }

  lifecycle {
    prevent_destroy = true
  }
}

output "database_id" {
  sensitive = true
  value     = cloudflare_d1_database.staging.id
}
