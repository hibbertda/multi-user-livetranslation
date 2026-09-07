#!/bin/sh
set -e

# Generate a same-origin external script with runtime config.
# Using a standalone .js file eliminates the need for 'unsafe-inline' in CSP.
# The file is written with a no-cache header via nginx (see config below).

CONFIG_DIR="${CONFIG_DIR:-/usr/share/nginx/html}"

# Build JSON with python3 (available in nginx:alpine) for correct escaping of
# all control characters, Unicode, quotes, backslashes, and </script>.
# The output is base64-encoded UTF-8 to avoid any shell/heredoc interpretation
# issues.  The generated JS decodes it at runtime via atob + TextDecoder.
generate_runtime_config() {
  _cfg_dir="$1"

  _b64=$(python3 -c "
import json, base64, os
obj = {
    'speechRegion':       os.environ.get('SPEECH_REGION', ''),
    'speechResourceName': os.environ.get('SPEECH_RESOURCE_NAME', ''),
    'translatorEndpoint': os.environ.get('TRANSLATOR_ENDPOINT', ''),
    'translatorRegion':   os.environ.get('TRANSLATOR_REGION', ''),
    'azureClientId':      os.environ.get('AZURE_CLIENT_ID', ''),
    'azureTenantId':      os.environ.get('AZURE_TENANT_ID', ''),
    'signalingEndpoint':  os.environ.get('SIGNALING_ENDPOINT', ''),
}
print(base64.b64encode(json.dumps(obj).encode('utf-8')).decode('ascii'))
")

  cat > "${_cfg_dir}/runtime-config.js" <<JSEOF
window.__APP_CONFIG__=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob("${_b64}"),function(c){return c.charCodeAt(0)})));
JSEOF

  # Inject a <script src> tag into index.html (no inline script).
  sed -i 's|</head>|<script src="/runtime-config.js"></script></head>|' "${_cfg_dir}/index.html"
}

generate_runtime_config "${CONFIG_DIR}"

exec "$@"
