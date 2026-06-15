variable "location" {
  description = "Azure region for all resources"
  type        = string
  default     = "eastus2"
}

variable "resource_group_name" {
  description = "Name of the resource group"
  type        = string
  default     = "rg-live-translation"
}

variable "speech_account_name" {
  description = "Name of the Cognitive Services Speech account"
  type        = string
  default     = "speech-live-translation"
}

variable "translator_account_name" {
  description = "Name of the Cognitive Services Translator account"
  type        = string
  default     = "translator-live-translation"
}

variable "user_principal_id" {
  description = "Object ID of the Entra ID user to grant Cognitive Services User role"
  type        = string
}

variable "resource_suffix" {
  description = "Random suffix for globally unique custom subdomain names"
  type        = string
}

variable "webpubsub_name" {
  description = "Name of the Azure Web PubSub resource for session signaling"
  type        = string
  default     = "wps-live-translation"
}

variable "func_app_name" {
  description = "Name of the Azure Function App for the session API"
  type        = string
  default     = "func-live-translation-session"
}

variable "func_storage_name" {
  description = "Storage account name for the Function App (must be globally unique, 3-24 chars, lowercase/digits only)"
  type        = string
  default     = "stlivetranslation"
}

variable "cosmosdb_account_name" {
  description = "Name of the Cosmos DB account for session records"
  type        = string
  default     = "cosmos-live-translation"
}

variable "audio_storage_name" {
  description = "Storage account name for session audio recordings (must be globally unique, 3-24 chars, lowercase/digits only)"
  type        = string
  default     = "stlivetransaudio"
}

variable "acr_name" {
  description = "Name of the Azure Container Registry (must be globally unique, 5-50 chars, alphanumeric only)"
  type        = string
  default     = "acrlivetranslation"
}

variable "container_app_name" {
  description = "Name of the Container App for the frontend"
  type        = string
  default     = "ca-live-translation"
}

variable "container_app_env_name" {
  description = "Name of the Container Apps Environment"
  type        = string
  default     = "cae-live-translation"
}

variable "azure_client_id" {
  description = "Entra ID App Registration client ID (for MSAL auth in the frontend)"
  type        = string
}

variable "azure_tenant_id" {
  description = "Entra ID tenant ID"
  type        = string
}
