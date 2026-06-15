output "speech_region" {
  description = "Region of the Speech Services resource"
  value       = azurerm_cognitive_account.speech.location
}

output "speech_resource_name" {
  description = "Custom subdomain name of the Speech resource (for token exchange)"
  value       = azurerm_cognitive_account.speech.custom_subdomain_name
}

output "translator_endpoint" {
  description = "Custom subdomain endpoint of the Translator resource"
  value       = "https://${azurerm_cognitive_account.translator.custom_subdomain_name}.cognitiveservices.azure.com"
}

output "translator_region" {
  description = "Region of the Translator resource"
  value       = azurerm_cognitive_account.translator.location
}

output "signaling_endpoint" {
  description = "HTTPS endpoint of the session signaling Function App"
  value       = "https://${azurerm_linux_function_app.session_api.default_hostname}"
}

output "webpubsub_hostname" {
  description = "Hostname of the Web PubSub resource"
  value       = azurerm_web_pubsub.signaling.hostname
}

output "cosmosdb_endpoint" {
  description = "Endpoint of the Cosmos DB account for session records"
  value       = azurerm_cosmosdb_account.sessions.endpoint
}

output "audio_storage_account" {
  description = "Name of the storage account for session audio"
  value       = azurerm_storage_account.audio.name
}

output "acr_login_server" {
  description = "Login server URL for the Azure Container Registry"
  value       = azurerm_container_registry.acr.login_server
}

output "frontend_url" {
  description = "Public URL of the frontend Container App"
  value       = "https://${azurerm_container_app.frontend.ingress[0].fqdn}"
}
