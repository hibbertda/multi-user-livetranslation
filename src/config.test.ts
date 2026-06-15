import { describe, expect, it } from 'vitest';
import { validateConfig, type AppConfig } from './config';

const validConfig: AppConfig = {
  speechRegion: 'eastus2',
  speechResourceName: 'speech-live-translation-abc123',
  translatorEndpoint: 'https://translator-live-translation-abc123.cognitiveservices.azure.com',
  translatorRegion: 'eastus2',
  azureClientId: '11111111-1111-4111-8111-111111111111',
  azureTenantId: '22222222-2222-4222-8222-222222222222',
  signalingEndpoint: '',
};

describe('validateConfig', () => {
  it('returns no errors for a valid configuration', () => {
    expect(validateConfig(validConfig)).toEqual([]);
  });

  it('reports missing or invalid values', () => {
    const errors = validateConfig({
      ...validConfig,
      speechRegion: '',
      azureClientId: 'bad-guid',
      translatorEndpoint: 'http://insecure-endpoint',
    });

    expect(errors).toContain('Missing speech region (VITE_SPEECH_REGION).');
    expect(errors).toContain('Azure client ID is missing or invalid (VITE_AZURE_CLIENT_ID).');
    expect(errors).toContain('Translator endpoint must use HTTPS.');
  });
});
