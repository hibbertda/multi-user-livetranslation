# Infrastructure

All Azure resources are managed with **Terraform** in the [`terraform/`](../terraform/) directory.

## Prerequisites

- **Terraform >= 1.5**
- **Azure CLI** authenticated (`az login`)
- An **Azure subscription** with sufficient quota
- A **Microsoft Entra ID App Registration** (client ID and tenant ID)

## Provision Resources

```bash
cd terraform

# Initialize Terraform
terraform init

# Review the plan
terraform plan -var="user_principal_id=YOUR_ENTRA_USER_OID" \
               -var="azure_client_id=YOUR_APP_CLIENT_ID" \
               -var="azure_tenant_id=YOUR_TENANT_ID"

# Apply
terraform apply -var="user_principal_id=YOUR_ENTRA_USER_OID" \
                -var="azure_client_id=YOUR_APP_CLIENT_ID" \
                -var="azure_tenant_id=YOUR_TENANT_ID"
```

After applying, grab the output values for your `.env` file:

```bash
terraform output
```

## Resources Created

| Resource | Purpose | SKU |
|----------|---------|-----|
| Azure Speech Services | Speech-to-text, text-to-speech, language ID | S0 |
| Azure Translator | Real-time text translation | S1 |
| Azure Web PubSub | WebSocket signaling for guest sessions | Free (F1) |
| Azure Functions | Session API (CRUD, audio upload, negotiate) | Consumption (Y1) |
| Azure Cosmos DB | Session & transcript storage | Serverless |
| Azure Storage (x2) | Function runtime + session audio blobs | Standard LRS |
| Azure Container Registry | Docker image hosting | Basic |
| Azure Container Apps | Frontend hosting (nginx + SPA) | Consumption |

## Authentication & Identity

All service-to-service auth uses **Managed Identity** — no keys or connection strings in config (except Web PubSub).

- **User-assigned managed identity** for Container App → ACR pull
- **System-assigned managed identity** for Function App → Cosmos DB, Blob Storage, Speech, Web PubSub
- **Entra ID tokens** for client-side access to Speech and Translator services

## Terraform Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `user_principal_id` | Yes | Your Entra ID user object ID (for RBAC assignments) |
| `azure_client_id` | Yes | App Registration client ID |
| `azure_tenant_id` | Yes | Entra tenant ID |
| `location` | No | Azure region (default: `eastus2`) |
| `resource_group_name` | No | Resource group name (default: `rg-live-translation`) |
| `resource_suffix` | No | Random suffix for globally unique names |

## Outputs

| Output | Description |
|--------|-------------|
| `speech_region` | Region for Speech Services |
| `speech_resource_name` | Speech resource name |
| `translator_endpoint` | Translator API endpoint URL |
| `translator_region` | Translator region |
| `signaling_endpoint` | Function App base URL |
| `webpubsub_hostname` | Web PubSub hostname |
| `cosmosdb_endpoint` | Cosmos DB endpoint |
| `audio_storage_account` | Blob Storage account name |
| `acr_login_server` | ACR login server (e.g., `acrlivetranslation.azurecr.io`) |
| `frontend_url` | Container App public URL |

## Cost Estimate

With the selected SKUs and consumption-based plans, the idle cost is minimal:

- **Speech S0** — Pay-per-use (no base cost)
- **Translator S1** — ~$10/mo (1M chars included)
- **Web PubSub Free** — 20 concurrent connections, 20K messages/day
- **Functions Consumption** — Pay-per-execution
- **Cosmos DB Serverless** — Pay-per-RU
- **Container Apps Consumption** — Pay-per-use (scales to zero)
- **ACR Basic** — ~$5/mo
