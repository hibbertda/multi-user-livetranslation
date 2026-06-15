# Architecture

## System Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                        Frontend (React + Vite)                   │
│            Hosted on Azure Container Apps (nginx)                │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────┐  ┌────────────────┐  ┌───────────────────────┐ │
│  │ Azure Speech │  │ Azure          │  │ Azure Function App    │ │
│  │ Services     │  │ Translator     │  │ (Session API)         │ │
│  │              │  │                │  │                       │ │
│  │ • STT        │  │ • Real-time    │  │ • CRUD sessions       │ │
│  │ • TTS        │  │   translation  │  │ • Audio upload        │ │
│  │ • Language ID │  │               │  │ • WebSocket negotiate │ │
│  └─────────────┘  └────────────────┘  └───────┬───────────────┘ │
│                                                │                 │
│                    ┌───────────────────┐       │                 │
│                    │ Azure Web PubSub  │       │                 │
│                    │ (guest signaling) │       │                 │
│                    └───────────────────┘  ┌────┴──────────┐     │
│                                          │ Cosmos DB      │     │
│                                          │ (sessions)     │     │
│                                          ├────────────────┤     │
│                                          │ Blob Storage   │     │
│                                          │ (audio files)  │     │
│                                          └────────────────┘     │
└──────────────────────────────────────────────────────────────────┘
```

## Frontend

- **React 19** single-page application built with **Vite** and **TypeScript**
- Served via **nginx** inside a Docker container on **Azure Container Apps**
- Runtime configuration injected at container startup via `docker-entrypoint.sh` (writes `window.__APP_CONFIG__` into `index.html`)
- Authentication via **MSAL** (`@azure/msal-browser`) — users sign in with Microsoft Entra ID

## Azure Speech Services

- **Speech-to-text (STT)** — Continuous recognition via the Speech SDK, streaming audio from the browser microphone
- **Text-to-speech (TTS)** — Neural voice synthesis for playback of translated utterances
- **Language identification** — Automatic detection of the spoken language from 50+ candidates
- Auth: Entra ID token obtained client-side via MSAL, no subscription keys exposed

## Azure Translator

- Real-time text translation between 10+ languages
- Two modes: **Standard** (sentence-level, higher accuracy) and **Real-time** (streaming, lower latency)
- Auth: Entra ID token, same as Speech

## Session API (Azure Functions)

- **Node.js v4 programming model** (ESM, TypeScript) on **Flex Consumption** plan
- Endpoints:
  - `GET /api/sessions` — List sessions for a user
  - `POST /api/sessions` — Create / update a session
  - `GET /api/sessions/:userId/:sessionId` — Get a single session
  - `DELETE /api/sessions/:userId` — Delete sessions
  - `POST /api/audio/upload` — Upload recorded audio chunks
  - `POST /api/pubsub/negotiate` — Obtain Web PubSub client token
- **Cosmos DB** — Session and transcript persistence (serverless, NoSQL)
- **Blob Storage** — Audio file storage
- **Web PubSub** — WebSocket signaling for real-time guest session sync
- All service access via **system-assigned managed identity** — no connection strings

## Guest Sharing Flow

1. Host creates a session and clicks **Invite**
2. A shareable link / QR code is generated containing a session token
3. Guest opens the link — no sign-in required
4. Guest's browser connects to **Web PubSub** via the Function App's negotiate endpoint
5. Host pushes live utterances to Web PubSub; guests receive them in real time
6. Guest selects their preferred display language; translation happens client-side

## Supported Languages

English, Arabic, Spanish, French, German, Chinese, Japanese, Portuguese, Hindi, Korean — plus automatic language detection from 50+ languages.

## Security

- **No API keys in client code** — All Azure service access uses Entra ID tokens obtained via MSAL
- **Managed Identity** — Function App accesses Cosmos DB, Blob Storage, Speech, and Web PubSub via system-assigned managed identity
- **Local auth disabled** — Speech Services and Cosmos DB have key-based auth disabled; only Entra ID tokens accepted
- **Guest sessions** — Validated via short-lived session tokens; no Entra ID account required for guests
- **Session storage** — MSAL cache uses `sessionStorage` (cleared on tab close)

## Project Structure

```
├── src/                    # React frontend (Vite + TypeScript)
│   ├── components/         # UI components
│   ├── hooks/              # Custom React hooks
│   ├── services/           # Azure SDK wrappers (speech, translator, signaling)
│   ├── auth/               # MSAL configuration
│   ├── utils/              # Helpers (telemetry, JWT, ID generation)
│   ├── App.tsx             # Main app component
│   ├── config.ts           # Runtime config (env vars / injected config)
│   └── types.ts            # Shared TypeScript types
├── api/                    # Azure Functions API (Node.js v4)
│   └── src/
│       ├── index.ts        # All HTTP function endpoints
│       ├── cosmos.ts       # Cosmos DB client
│       ├── storage.ts      # Blob Storage client
│       └── pubsub.ts       # Web PubSub client
├── terraform/              # Infrastructure as Code
├── .github/workflows/      # CI/CD pipelines
├── Dockerfile              # Multi-stage build (node → nginx)
├── nginx.conf              # SPA routing + static asset caching
├── docker-entrypoint.sh    # Runtime env var injection
└── dev-relay.mjs           # Local WebSocket relay for dev
```
