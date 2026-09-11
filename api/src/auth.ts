import type { HttpRequest } from '@azure/functions';

export interface ClientPrincipalClaim {
  typ?: string;
  val?: string;
}

export interface ClientPrincipal {
  auth_typ?: string;
  name_typ?: string;
  role_typ?: string;
  claims?: ClientPrincipalClaim[];
}

export interface AuthenticatedUser {
  userId: string;
  email?: string;
  name?: string;
  authType?: string;
  roles: string[];
}

const USER_ID_CLAIMS = [
  'http://schemas.microsoft.com/identity/claims/objectidentifier',
  'oid',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier',
  'nameidentifier',
];

const EMAIL_CLAIMS = [
  'preferred_username',
  'emails',
  'email',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
];

const NAME_CLAIMS = [
  'name',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname',
];

function findClaimValue(claims: ClientPrincipalClaim[] = [], claimTypes: string[]): string | undefined {
  for (const claimType of claimTypes) {
    const value = claims.find((claim) => claim.typ === claimType)?.val?.trim();
    if (value) return value;
  }
  return undefined;
}

export function decodeClientPrincipal(encodedPrincipal: string | null | undefined): ClientPrincipal | null {
  if (!encodedPrincipal) return null;

  try {
    const json = Buffer.from(encodedPrincipal, 'base64').toString('utf8');
    const parsed = JSON.parse(json) as ClientPrincipal;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function extractAuthenticatedUser(principal: ClientPrincipal | null): AuthenticatedUser | null {
  if (!principal) return null;

  const claims = principal.claims ?? [];
  const userId = findClaimValue(claims, USER_ID_CLAIMS);
  if (!userId) return null;

  const roleClaimType = principal.role_typ;
  const roles = claims
    .filter((claim) => claim.val && claim.typ && (claim.typ === roleClaimType || claim.typ === 'roles'))
    .map((claim) => claim.val!.trim())
    .filter(Boolean);

  return {
    userId,
    email: findClaimValue(claims, EMAIL_CLAIMS),
    name: findClaimValue(claims, NAME_CLAIMS),
    authType: principal.auth_typ,
    roles,
  };
}

export function getAuthenticatedUser(req: Pick<HttpRequest, 'headers'>): AuthenticatedUser | null {
  return extractAuthenticatedUser(decodeClientPrincipal(req.headers.get('x-ms-client-principal')));
}
