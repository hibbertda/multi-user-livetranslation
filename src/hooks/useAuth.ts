import { useMsal } from '@azure/msal-react';
import { useCallback, useMemo, useRef } from 'react';
import type { AccountInfo } from '@azure/msal-browser';
import { apiRequest, loginRequest, graphRequest } from '../auth/msalConfig';
import { config } from '../config';
import { getTokenExpiryMs, getTokenTenantId } from '../utils/jwt';
import { trackEvent } from '../utils/telemetry';

interface CachedToken {
  accessToken: string;
  expiresAtMs: number;
}

const TOKEN_EXPIRY_BUFFER_MS = 60_000;

function getAccountUserId(account: AccountInfo | undefined): string | undefined {
  const claims = account?.idTokenClaims as Record<string, unknown> | undefined;
  const oid = typeof claims?.oid === 'string' ? claims.oid : undefined;
  const sub = typeof claims?.sub === 'string' ? claims.sub : undefined;
  return oid ?? account?.localAccountId ?? sub;
}

export function useAuth() {
  const { instance, accounts } = useMsal();
  const account = accounts[0];
  const userId = useMemo(() => getAccountUserId(account), [account]);
  const tokenCacheRef = useRef<Record<string, CachedToken>>({});

  const validateTokenTenant = useCallback((token: string) => {
    const tokenTenantId = getTokenTenantId(token);
    if (!tokenTenantId) return;

    if (tokenTenantId.toLowerCase() !== config.azureTenantId.toLowerCase()) {
      throw new Error(
        `Authenticated tenant (${tokenTenantId}) does not match configured tenant (${config.azureTenantId}).`,
      );
    }
  }, []);

  const acquireCachedToken = useCallback(
    async (cacheKey: string, scopes: string[]): Promise<string> => {
      const now = Date.now();
      const cached = tokenCacheRef.current[cacheKey];
      if (cached && cached.expiresAtMs - TOKEN_EXPIRY_BUFFER_MS > now) {
        trackEvent('auth.token.cache_hit', { cacheKey });
        return cached.accessToken;
      }

      if (!account) throw new Error('Not authenticated');
      trackEvent('auth.token.cache_miss', { cacheKey });

      const result = await instance.acquireTokenSilent({
        scopes,
        account,
      });

      validateTokenTenant(result.accessToken);
      const expiresAtMs = getTokenExpiryMs(result.accessToken) ?? Date.now() + 5 * 60 * 1000;
      tokenCacheRef.current[cacheKey] = {
        accessToken: result.accessToken,
        expiresAtMs,
      };

      return result.accessToken;
    },
    [account, instance, validateTokenTenant],
  );

  const login = useCallback(() => {
    instance.loginRedirect(loginRequest);
  }, [instance]);

  const logout = useCallback(() => {
    instance.logoutRedirect();
  }, [instance]);

  const getToken = useCallback(async (): Promise<string> => {
    return acquireCachedToken('cognitive', loginRequest.scopes);
  }, [acquireCachedToken]);

  const getApiToken = useCallback(async (): Promise<string> => {
    try {
      return await acquireCachedToken('api', apiRequest.scopes);
    } catch {
      if (!account) throw new Error('Not authenticated');
      const result = await instance.acquireTokenPopup(apiRequest);
      validateTokenTenant(result.accessToken);
      const expiresAtMs = getTokenExpiryMs(result.accessToken) ?? Date.now() + 5 * 60 * 1000;
      tokenCacheRef.current.api = {
        accessToken: result.accessToken,
        expiresAtMs,
      };
      return result.accessToken;
    }
  }, [acquireCachedToken, account, instance, validateTokenTenant]);

  const getGraphToken = useCallback(async (): Promise<string> => {
    try {
      return await acquireCachedToken('graph', graphRequest.scopes);
    } catch {
      if (!account) throw new Error('Not authenticated');
      const result = await instance.acquireTokenPopup(graphRequest);
      validateTokenTenant(result.accessToken);
      const expiresAtMs = getTokenExpiryMs(result.accessToken) ?? Date.now() + 5 * 60 * 1000;
      tokenCacheRef.current.graph = {
        accessToken: result.accessToken,
        expiresAtMs,
      };
      return result.accessToken;
    }
  }, [acquireCachedToken, account, instance, validateTokenTenant]);

  return { account, userId, login, logout, getToken, getApiToken, getGraphToken };
}
