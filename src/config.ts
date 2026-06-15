export interface AppConfig {
  speechRegion: string;
  speechResourceName: string;
  translatorEndpoint: string;
  translatorRegion: string;
  azureClientId: string;
  azureTenantId: string;
  signalingEndpoint: string;
}

declare global {
  interface Window {
    __APP_CONFIG__?: Partial<AppConfig>;
  }
}

function getConfig(): AppConfig {
  const runtime = window.__APP_CONFIG__ ?? {};

  return {
    speechRegion: runtime.speechRegion ?? import.meta.env.VITE_SPEECH_REGION ?? '',
    speechResourceName: runtime.speechResourceName ?? import.meta.env.VITE_SPEECH_RESOURCE_NAME ?? '',
    translatorEndpoint: runtime.translatorEndpoint ?? import.meta.env.VITE_TRANSLATOR_ENDPOINT ?? '',
    translatorRegion: runtime.translatorRegion ?? import.meta.env.VITE_TRANSLATOR_REGION ?? '',
    azureClientId: runtime.azureClientId ?? import.meta.env.VITE_AZURE_CLIENT_ID ?? '',
    azureTenantId: runtime.azureTenantId ?? import.meta.env.VITE_AZURE_TENANT_ID ?? '',
    signalingEndpoint: runtime.signalingEndpoint ?? import.meta.env.VITE_SIGNALING_ENDPOINT ?? '',
  };
}

export const config = getConfig();

function isGuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function validateConfig(currentConfig: AppConfig = config): string[] {
  const errors: string[] = [];

  if (!currentConfig.speechRegion.trim()) {
    errors.push('Missing speech region (VITE_SPEECH_REGION).');
  }

  if (!currentConfig.speechResourceName.trim()) {
    errors.push('Missing speech resource name (VITE_SPEECH_RESOURCE_NAME).');
  }

  if (!currentConfig.translatorEndpoint.trim()) {
    errors.push('Missing translator endpoint (VITE_TRANSLATOR_ENDPOINT).');
  }

  if (!currentConfig.translatorRegion.trim()) {
    errors.push('Missing translator region (VITE_TRANSLATOR_REGION).');
  }

  if (!currentConfig.azureClientId.trim() || !isGuid(currentConfig.azureClientId.trim())) {
    errors.push('Azure client ID is missing or invalid (VITE_AZURE_CLIENT_ID).');
  }

  if (!currentConfig.azureTenantId.trim() || !isGuid(currentConfig.azureTenantId.trim())) {
    errors.push('Azure tenant ID is missing or invalid (VITE_AZURE_TENANT_ID).');
  }

  if (currentConfig.translatorEndpoint && !/^https:\/\//i.test(currentConfig.translatorEndpoint)) {
    errors.push('Translator endpoint must use HTTPS.');
  }

  return errors;
}
