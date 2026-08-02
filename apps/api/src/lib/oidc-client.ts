import {
  ClientSecretPost,
  allowInsecureRequests,
  authorizationCodeGrant,
  buildAuthorizationUrl,
  calculatePKCECodeChallenge,
  discovery,
  fetchUserInfo,
  randomPKCECodeVerifier,
  randomState,
  type Configuration,
} from 'openid-client';
import type { OidcEnvConfig } from '@project-knowledge-hub/config';

const STATE_KEY_PREFIX = 'oidc:state:';
const STATE_TTL_SECONDS = 600;

export type OidcPendingState = {
  codeVerifier: string;
  redirectUri: string;
};

export type OidcClaims = {
  subject: string;
  email: string | null;
  emailVerified: boolean;
};

let cachedConfig: { issuer: string; clientId: string; config: Configuration } | null =
  null;

function discoveryOptions(issuer: string) {
  if (issuer.startsWith('http://')) {
    return { execute: [allowInsecureRequests] };
  }
  return undefined;
}

export async function getOidcConfiguration(oidc: OidcEnvConfig): Promise<Configuration> {
  if (
    cachedConfig &&
    cachedConfig.issuer === oidc.issuer &&
    cachedConfig.clientId === oidc.clientId
  ) {
    return cachedConfig.config;
  }

  const config = await discovery(
    new URL(oidc.issuer),
    oidc.clientId,
    oidc.clientSecret,
    ClientSecretPost(oidc.clientSecret),
    discoveryOptions(oidc.issuer),
  );
  cachedConfig = { issuer: oidc.issuer, clientId: oidc.clientId, config };
  return config;
}

/** Test helper — clear discovery cache between tests. */
export function clearOidcConfigurationCache(): void {
  cachedConfig = null;
}

export async function beginOidcAuthorization(oidc: OidcEnvConfig): Promise<{
  authorizationUrl: URL;
  state: string;
  pending: OidcPendingState;
}> {
  const config = await getOidcConfiguration(oidc);
  const codeVerifier = randomPKCECodeVerifier();
  const codeChallenge = await calculatePKCECodeChallenge(codeVerifier);
  const state = randomState();
  const authorizationUrl = buildAuthorizationUrl(config, {
    redirect_uri: oidc.redirectUri,
    scope: 'openid email profile',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
  });
  return {
    authorizationUrl,
    state,
    pending: { codeVerifier, redirectUri: oidc.redirectUri },
  };
}

export async function completeOidcAuthorization(
  oidc: OidcEnvConfig,
  currentUrl: URL,
  pending: OidcPendingState,
  expectedState: string,
): Promise<OidcClaims> {
  const config = await getOidcConfiguration(oidc);
  const tokens = await authorizationCodeGrant(config, currentUrl, {
    pkceCodeVerifier: pending.codeVerifier,
    expectedState,
  });

  const idClaims = tokens.claims();
  const subject = typeof idClaims?.sub === 'string' ? idClaims.sub : null;
  if (!subject) {
    throw new Error('OIDC token response missing subject');
  }

  let email =
    typeof idClaims?.email === 'string' ? idClaims.email.trim().toLowerCase() : null;
  let emailVerified = isEmailVerifiedClaim(idClaims?.email_verified);

  const accessToken = tokens.access_token;
  if (accessToken && (!email || !emailVerified)) {
    try {
      const userinfo = await fetchUserInfo(config, accessToken, subject);
      if (!email && typeof userinfo.email === 'string') {
        email = userinfo.email.trim().toLowerCase();
      }
      if (!emailVerified) {
        emailVerified = isEmailVerifiedClaim(userinfo.email_verified);
      }
    } catch {
      // userinfo optional when ID token already carries email
    }
  }

  return { subject, email, emailVerified };
}

export function oidcStateRedisKey(state: string): string {
  return `${STATE_KEY_PREFIX}${state}`;
}

export function oidcStateTtlSeconds(): number {
  return STATE_TTL_SECONDS;
}

export function serializeOidcPendingState(pending: OidcPendingState): string {
  return JSON.stringify(pending);
}

export function parseOidcPendingState(raw: string): OidcPendingState | null {
  try {
    const parsed = JSON.parse(raw) as Partial<OidcPendingState>;
    if (
      typeof parsed.codeVerifier !== 'string' ||
      typeof parsed.redirectUri !== 'string' ||
      !parsed.codeVerifier ||
      !parsed.redirectUri
    ) {
      return null;
    }
    return { codeVerifier: parsed.codeVerifier, redirectUri: parsed.redirectUri };
  } catch {
    return null;
  }
}

function isEmailVerifiedClaim(value: unknown): boolean {
  return value === true || value === 'true';
}
