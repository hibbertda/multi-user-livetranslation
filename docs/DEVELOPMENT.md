# Development

## Prerequisites

- **Node.js 22+** and npm
- **Azure subscription** with services provisioned (see [Infrastructure](INFRASTRUCTURE.md))
- **Microsoft Entra ID App Registration** with redirect URI configured for `https://localhost:5173`
- **Azure Functions Core Tools** (for running the API locally)

## Setup

### 1. Clone & Install

```bash
git clone https://github.com/your-org/live-translation.git
cd live-translation
npm install
cd api && npm install && cd ..
```

### 2. Configure Environment

Copy the example env file and fill in your Azure resource values:

```bash
cp .env.example .env
```

```env
VITE_SPEECH_REGION=eastus2
VITE_SPEECH_RESOURCE_NAME=speech-live-translation-xxxxxx
VITE_TRANSLATOR_ENDPOINT=https://translator-live-translation-xxxxxx.cognitiveservices.azure.com
VITE_TRANSLATOR_REGION=eastus2
VITE_AZURE_CLIENT_ID=your-entra-app-client-id
VITE_AZURE_TENANT_ID=your-entra-tenant-id
VITE_SIGNALING_ENDPOINT=https://your-function-app.azurewebsites.net
```

All values are available from Terraform outputs after provisioning — see [Infrastructure](INFRASTRUCTURE.md).

### 3. Run Locally

```bash
# Terminal 1: Start the WebSocket relay (for guest sharing in dev)
node dev-relay.mjs

# Terminal 2: Start the Vite dev server (HTTPS with hot reload)
npm run dev
```

Open `https://localhost:5173` and sign in with your Entra ID account.

> **Note**: The dev server uses a self-signed SSL certificate via `@vitejs/plugin-basic-ssl`. Your browser will show a security warning — this is expected for local development.

### Running the Full Stack

```bash
# 1. Start the WebSocket relay (guest signaling)
node dev-relay.mjs

# 2. Start the API (requires Azure Functions Core Tools)
cd api && npm start

# 3. Start the frontend
npm run dev
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite dev server with HTTPS + HMR |
| `npm run build` | Type-check and build for production |
| `npm test` | Run unit tests (Vitest) |
| `npm run test:watch` | Run tests in watch mode |
| `npm run lint` | Lint with ESLint |
| `node dev-relay.mjs` | Start local WebSocket relay for guest sharing |
| `cd api && npm start` | Start Azure Functions API locally |

## Testing

```bash
npm test                 # Run all tests
npm run test:watch       # Watch mode
```

## Docker (Local)

```bash
# Build
docker build -t live-translation .

# Run (pass your Azure config as env vars)
docker run -p 8080:8080 \
  -e SPEECH_REGION=eastus2 \
  -e SPEECH_RESOURCE_NAME=your-speech-resource \
  -e TRANSLATOR_ENDPOINT=https://your-translator.cognitiveservices.azure.com \
  -e TRANSLATOR_REGION=eastus2 \
  -e AZURE_CLIENT_ID=your-client-id \
  -e AZURE_TENANT_ID=your-tenant-id \
  live-translation
```

The Docker image uses a multi-stage build (Node.js for building, nginx for serving). The `docker-entrypoint.sh` script injects environment variables into the SPA at container startup as `window.__APP_CONFIG__`.
