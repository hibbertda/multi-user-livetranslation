interface JwtPayload {
  exp?: number;
  tid?: string;
}

function decodeBase64Url(value: string): string {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
  return atob(padded);
}

export function parseJwt(token: string): JwtPayload {
  const parts = token.split('.');
  if (parts.length < 2) return {};

  try {
    const payload = decodeBase64Url(parts[1]);
    return JSON.parse(payload) as JwtPayload;
  } catch {
    return {};
  }
}

export function getTokenExpiryMs(token: string): number | null {
  const payload = parseJwt(token);
  if (!payload.exp) return null;
  return payload.exp * 1000;
}

export function getTokenTenantId(token: string): string | null {
  const payload = parseJwt(token);
  return payload.tid ?? null;
}
