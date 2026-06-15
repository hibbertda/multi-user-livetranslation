#!/bin/sh
set -e

# Inject runtime environment variables into index.html
sed -i "s|</head>|<script>window.__APP_CONFIG__={speechRegion:\"${SPEECH_REGION}\",speechResourceName:\"${SPEECH_RESOURCE_NAME}\",translatorEndpoint:\"${TRANSLATOR_ENDPOINT}\",translatorRegion:\"${TRANSLATOR_REGION}\",azureClientId:\"${AZURE_CLIENT_ID}\",azureTenantId:\"${AZURE_TENANT_ID}\",signalingEndpoint:\"${SIGNALING_ENDPOINT}\"};</script></head>|" /usr/share/nginx/html/index.html

exec "$@"
