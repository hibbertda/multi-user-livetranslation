resource "azurerm_resource_group" "main" {
  name     = var.resource_group_name
  location = var.location
}

# ---------- Azure Speech Services ----------

resource "azurerm_cognitive_account" "speech" {
  name                  = var.speech_account_name
  location              = azurerm_resource_group.main.location
  resource_group_name   = azurerm_resource_group.main.name
  kind                  = "SpeechServices"
  sku_name              = "S0"
  custom_subdomain_name = "${var.speech_account_name}-${var.resource_suffix}"
  local_auth_enabled    = false
}

# ---------- Azure Translator ----------

resource "azurerm_cognitive_account" "translator" {
  name                  = var.translator_account_name
  location              = azurerm_resource_group.main.location
  resource_group_name   = azurerm_resource_group.main.name
  kind                  = "TextTranslation"
  sku_name              = "S1"
  custom_subdomain_name = "${var.translator_account_name}-${var.resource_suffix}"
  local_auth_enabled    = false
}

# ---------- Role Assignments ----------

resource "azurerm_role_assignment" "speech_user" {
  scope                = azurerm_cognitive_account.speech.id
  role_definition_name = "Cognitive Services User"
  principal_id         = var.user_principal_id
}

resource "azurerm_role_assignment" "translator_user" {
  scope                = azurerm_cognitive_account.translator.id
  role_definition_name = "Cognitive Services User"
  principal_id         = var.user_principal_id
}

# ---------- Azure Web PubSub (session signaling) ----------

resource "azurerm_web_pubsub" "signaling" {
  name                = var.webpubsub_name
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  sku                 = "Free_F1"
  capacity            = 1
}

# ---------- Session API (Azure Function) ----------

resource "azurerm_storage_account" "func" {
  name                     = var.func_storage_name
  resource_group_name      = azurerm_resource_group.main.name
  location                 = azurerm_resource_group.main.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
  shared_access_key_enabled = false
}

resource "azurerm_service_plan" "func" {
  name                = "${var.func_app_name}-plan"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  os_type             = "Linux"
  sku_name            = "Y1"
}

resource "azurerm_linux_function_app" "session_api" {
  name                       = var.func_app_name
  location                   = azurerm_resource_group.main.location
  resource_group_name        = azurerm_resource_group.main.name
  service_plan_id            = azurerm_service_plan.func.id
  storage_account_name          = azurerm_storage_account.func.name
  storage_uses_managed_identity = true

  site_config {
    application_stack {
      node_version = "22"
    }
    cors {
      allowed_origins = ["*"]
    }
  }

  app_settings = {
    "WebPubSubConnectionString" = azurerm_web_pubsub.signaling.primary_connection_string
    "SPEECH_REGION"             = azurerm_cognitive_account.speech.location
    "SPEECH_RESOURCE_NAME"      = azurerm_cognitive_account.speech.custom_subdomain_name
    "COSMOS_ENDPOINT"           = azurerm_cosmosdb_account.sessions.endpoint
    "COSMOS_DATABASE"           = azurerm_cosmosdb_sql_database.sessions.name
    "COSMOS_CONTAINER"          = azurerm_cosmosdb_sql_container.sessions.name
    "AUDIO_STORAGE_ACCOUNT"     = azurerm_storage_account.audio.name
    "AUDIO_STORAGE_CONTAINER"   = azurerm_storage_container.audio.name
  }

  identity {
    type = "SystemAssigned"
  }
}

resource "azurerm_role_assignment" "func_speech_user" {
  scope                = azurerm_cognitive_account.speech.id
  role_definition_name = "Cognitive Services User"
  principal_id         = azurerm_linux_function_app.session_api.identity[0].principal_id
}

# Storage Blob Data Owner on func storage (required for managed identity storage)
resource "azurerm_role_assignment" "func_storage_blob_owner" {
  scope                = azurerm_storage_account.func.id
  role_definition_name = "Storage Blob Data Owner"
  principal_id         = azurerm_linux_function_app.session_api.identity[0].principal_id
}

# Storage Account Contributor on func storage (required for managed identity storage)
resource "azurerm_role_assignment" "func_storage_contributor" {
  scope                = azurerm_storage_account.func.id
  role_definition_name = "Storage Account Contributor"
  principal_id         = azurerm_linux_function_app.session_api.identity[0].principal_id
}

# Storage Queue Data Contributor on func storage (required for function triggers)
resource "azurerm_role_assignment" "func_storage_queue" {
  scope                = azurerm_storage_account.func.id
  role_definition_name = "Storage Queue Data Contributor"
  principal_id         = azurerm_linux_function_app.session_api.identity[0].principal_id
}

# Storage Table Data Contributor on func storage (required for function runtime)
resource "azurerm_role_assignment" "func_storage_table" {
  scope                = azurerm_storage_account.func.id
  role_definition_name = "Storage Table Data Contributor"
  principal_id         = azurerm_linux_function_app.session_api.identity[0].principal_id
}

resource "azurerm_role_assignment" "func_webpubsub" {
  scope                = azurerm_web_pubsub.signaling.id
  role_definition_name = "Web PubSub Service Owner"
  principal_id         = azurerm_linux_function_app.session_api.identity[0].principal_id
}

# ---------- Cosmos DB (Session Records) ----------

resource "azurerm_cosmosdb_account" "sessions" {
  name                          = var.cosmosdb_account_name
  location                      = azurerm_resource_group.main.location
  resource_group_name           = azurerm_resource_group.main.name
  offer_type                    = "Standard"
  kind                          = "GlobalDocumentDB"
  local_authentication_disabled = true

  consistency_policy {
    consistency_level = "Session"
  }

  geo_location {
    location          = azurerm_resource_group.main.location
    failover_priority = 0
  }

  capabilities {
    name = "EnableServerless"
  }
}

resource "azurerm_cosmosdb_sql_database" "sessions" {
  name                = "live-translation"
  resource_group_name = azurerm_resource_group.main.name
  account_name        = azurerm_cosmosdb_account.sessions.name
}

resource "azurerm_cosmosdb_sql_container" "sessions" {
  name                = "sessions"
  resource_group_name = azurerm_resource_group.main.name
  account_name        = azurerm_cosmosdb_account.sessions.name
  database_name       = azurerm_cosmosdb_sql_database.sessions.name
  partition_key_paths = ["/id"]

  indexing_policy {
    indexing_mode = "consistent"

    included_path {
      path = "/startedAt/?"
    }

    included_path {
      path = "/hostName/?"
    }

    included_path {
      path = "/status/?"
    }

    excluded_path {
      path = "/*"
    }
  }
}

# Cosmos DB role assignment for Function App
resource "azurerm_cosmosdb_sql_role_assignment" "func_cosmos" {
  resource_group_name = azurerm_resource_group.main.name
  account_name        = azurerm_cosmosdb_account.sessions.name
  role_definition_id  = "${azurerm_cosmosdb_account.sessions.id}/sqlRoleDefinitions/00000000-0000-0000-0000-000000000002"
  principal_id        = azurerm_linux_function_app.session_api.identity[0].principal_id
  scope               = azurerm_cosmosdb_account.sessions.id
}

# ---------- Blob Storage (Session Audio) ----------

resource "azurerm_storage_account" "audio" {
  name                     = var.audio_storage_name
  resource_group_name      = azurerm_resource_group.main.name
  location                 = azurerm_resource_group.main.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
  shared_access_key_enabled = false
}

resource "azurerm_storage_container" "audio" {
  name                 = "session-audio"
  storage_account_id   = azurerm_storage_account.audio.id
  container_access_type = "private"
}

# Storage Blob Data Contributor for Function App
resource "azurerm_role_assignment" "func_audio_blob" {
  scope                = azurerm_storage_account.audio.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = azurerm_linux_function_app.session_api.identity[0].principal_id
}

# ---------- Azure Container Registry ----------

resource "azurerm_container_registry" "acr" {
  name                = var.acr_name
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  sku                 = "Basic"
  admin_enabled       = false
}

# User-assigned identity for ACR pull (avoids chicken-and-egg with system-assigned)
resource "azurerm_user_assigned_identity" "frontend" {
  name                = "id-${var.container_app_name}"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
}

resource "azurerm_role_assignment" "acr_pull" {
  scope                = azurerm_container_registry.acr.id
  role_definition_name = "AcrPull"
  principal_id         = azurerm_user_assigned_identity.frontend.principal_id
}

# ---------- Container Apps (Frontend) ----------

resource "azurerm_container_app_environment" "main" {
  name                = var.container_app_env_name
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location

  lifecycle {
    ignore_changes = [infrastructure_resource_group_name]
  }
}

resource "azurerm_container_app" "frontend" {
  name                         = var.container_app_name
  container_app_environment_id = azurerm_container_app_environment.main.id
  resource_group_name          = azurerm_resource_group.main.name
  revision_mode                = "Single"

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.frontend.id]
  }

  registry {
    server   = azurerm_container_registry.acr.login_server
    identity = azurerm_user_assigned_identity.frontend.id
  }

  template {
    min_replicas = 0
    max_replicas = 1

    container {
      name   = "frontend"
      image  = "${azurerm_container_registry.acr.login_server}/live-translation:latest"
      cpu    = 0.25
      memory = "0.5Gi"

      env {
        name  = "SPEECH_REGION"
        value = azurerm_cognitive_account.speech.location
      }
      env {
        name  = "SPEECH_RESOURCE_NAME"
        value = azurerm_cognitive_account.speech.custom_subdomain_name
      }
      env {
        name  = "TRANSLATOR_ENDPOINT"
        value = "https://${azurerm_cognitive_account.translator.custom_subdomain_name}.cognitiveservices.azure.com"
      }
      env {
        name  = "TRANSLATOR_REGION"
        value = azurerm_cognitive_account.translator.location
      }
      env {
        name  = "AZURE_CLIENT_ID"
        value = var.azure_client_id
      }
      env {
        name  = "AZURE_TENANT_ID"
        value = var.azure_tenant_id
      }
      env {
        name  = "SIGNALING_ENDPOINT"
        value = "https://${azurerm_linux_function_app.session_api.default_hostname}"
      }
    }
  }

  ingress {
    external_enabled = true
    target_port      = 8080
    transport        = "auto"

    traffic_weight {
      percentage      = 100
      latest_revision = true
    }
  }
}
