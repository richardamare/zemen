output "database_id" {
  sensitive = true
  value     = cloudflare_d1_database.this.id
}
