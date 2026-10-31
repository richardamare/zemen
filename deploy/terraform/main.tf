resource "cloudflare_d1_database" "this" {
  account_id = var.account_id
  name       = "zemen-${var.environment}"

  read_replication = {
    mode = "disabled"
  }

  lifecycle {
    prevent_destroy = true
  }
}
