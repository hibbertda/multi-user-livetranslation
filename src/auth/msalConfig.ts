import type { Configuration } from '@azure/msal-browser';
import { LogLevel } from '@azure/msal-browser';
import { config } from '../config';
import { trackEvent } from '../utils/telemetry';

export const msalConfig: Configuration = {
  auth: {
    clientId: config.azureClientId,
    authority: `https://login.microsoftonline.com/${config.azureTenantId}`,
    redirectUri: window.location.origin,
  },
  cache: {
    cacheLocation: 'sessionStorage',
  },
  system: {
    loggerOptions: {
      logLevel: LogLevel.Warning,
      loggerCallback: (level, message) => {
        trackEvent('msal.log', {
          level,
          message,
        });
      },
    },
  },
};

export const loginRequest = {
  scopes: ['https://cognitiveservices.azure.com/.default'],
};

export const graphRequest = {
  scopes: ['User.Read'],
};
