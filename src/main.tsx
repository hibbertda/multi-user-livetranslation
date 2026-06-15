import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PublicClientApplication } from '@azure/msal-browser';
import { MsalProvider } from '@azure/msal-react';
import { msalConfig } from './auth/msalConfig';
import { validateConfig } from './config';
import { trackEvent } from './utils/telemetry';
import App from './App';
import { GuestApp } from './components/GuestApp';
import './index.css';

// ---------- Guest join route (no auth required) ----------
const params = new URLSearchParams(window.location.search);
const guestSessionId = params.get('session');
const guestToken = params.get('token');
const isGuestJoin = window.location.pathname === '/join' && guestSessionId && guestToken;

if (isGuestJoin) {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <GuestApp sessionId={guestSessionId} token={guestToken} />
    </StrictMode>,
  );
} else {
  // ---------- Normal host app with MSAL ----------
  const msalInstance = new PublicClientApplication(msalConfig);
  const configErrors = validateConfig();

  if (configErrors.length > 0) {
    const root = document.getElementById('root');
    if (root) {
      createRoot(root).render(
        <StrictMode>
          <div className="config-error-screen">
            <h1>Configuration Error</h1>
            <p>The app cannot start until these configuration issues are fixed:</p>
            <ul>
              {configErrors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          </div>
        </StrictMode>,
      );
    }
  } else {
    msalInstance.initialize().then(() => {
      trackEvent('msal.initialize.success');
      return msalInstance.handleRedirectPromise();
    }).then((response) => {
      if (response) {
        trackEvent('msal.redirect.success', {
          hasAccount: Boolean(response.account?.username),
        });
        msalInstance.setActiveAccount(response.account);
      } else {
        trackEvent('msal.redirect.no_response');
      }
    }).catch((error) => {
      trackEvent('msal.initialize.failure', {
        error: error instanceof Error ? error.message : String(error),
      });
    }).then(() => {
      createRoot(document.getElementById('root')!).render(
        <StrictMode>
          <MsalProvider instance={msalInstance}>
            <App />
          </MsalProvider>
        </StrictMode>,
      );
    });
  }
}
