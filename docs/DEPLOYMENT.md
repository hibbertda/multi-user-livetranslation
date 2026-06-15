# Deployment

## Frontend (Container Apps)

Build and push the Docker image, then update the Container App:

```bash
# Option A: Build in the cloud (no local Docker required)
az acr build --registry acrlivetranslation --image live-translation:latest .

# Option B: Build locally and push
ACR=$(cd terraform && terraform output -raw acr_login_server)
az acr login --name $ACR
docker build -t $ACR/live-translation:latest .
docker push $ACR/live-translation:latest
```

Then update the Container App to pull the new image:

```bash
az containerapp update \
  --name ca-live-translation \
  --resource-group rg-live-translation \
  --image acrlivetranslation.azurecr.io/live-translation:latest
```

### Environment Variables

The Container App passes Azure config as environment variables. The `docker-entrypoint.sh` script reads these at startup and injects them into the SPA as `window.__APP_CONFIG__`. These are configured in Terraform — you shouldn't need to set them manually.

## API (Azure Functions)

```bash
cd api
npm run build
func azure functionapp publish func-live-translation-session
```

## CI/CD (GitHub Actions)

Pre-built workflow scaffolds are in [`.github/workflows/`](../.github/workflows/):

- **`ci.yml`** — Runs lint, type check, tests, and build on every PR and push to `main`
- **`deploy.yml`** — Builds Docker image, pushes to ACR, and deploys to Container Apps + Functions (manual trigger via `workflow_dispatch`)

### Enable Automated Deployments

1. **Set up OIDC federation** between GitHub and your Azure subscription — [Microsoft docs](https://learn.microsoft.com/en-us/entra/workload-id/workload-identity-federation-create-trust)

2. **Configure GitHub secrets**:

   | Secret | Value |
   |--------|-------|
   | `AZURE_CLIENT_ID` | App Registration client ID (federated credential) |
   | `AZURE_TENANT_ID` | Entra tenant ID |
   | `AZURE_SUBSCRIPTION_ID` | Azure subscription ID |
   | `ACR_LOGIN_SERVER` | e.g., `acrlivetranslation.azurecr.io` |
   | `AZURE_RESOURCE_GROUP` | e.g., `rg-live-translation` |
   | `CONTAINER_APP_NAME` | e.g., `ca-live-translation` |
   | `FUNC_APP_NAME` | e.g., `func-live-translation-session` |

3. **Remove the `if: false` guards** from the deploy jobs in `deploy.yml`

### Post-Deployment Checklist

- [ ] Add your Container App URL as a **SPA redirect URI** in the Entra ID App Registration (Azure Portal → App registrations → Authentication)
- [ ] Verify the site loads and MSAL login works
- [ ] Test Speech recognition and translation from the deployed URL
- [ ] Verify guest invite links generate correctly with the production domain
