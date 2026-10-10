import {
  createHash,
  createPrivateKey,
  createPublicKey,
  createSign,
  createVerify,
  type KeyObject,
} from 'node:crypto';

export type OauthSigningMaterial = {
  privateKey: KeyObject;
  publicKey: KeyObject;
  kid: string;
  fingerprint: string;
  jwk: Record<string, unknown>;
};

export function normalizePem(value: string): string {
  const trimmed = value.trim();
  if (trimmed.includes('\\n')) {
    return trimmed.replace(/\\n/g, '\n');
  }
  return trimmed;
}

export function readOauthSigningKey(pem: string | undefined): OauthSigningMaterial | null {
  if (!pem?.trim()) {
    return null;
  }
  try {
    const privateKey = createPrivateKey(normalizePem(pem));
    const publicKey = createPublicKey(privateKey);
    const der = publicKey.export({ type: 'spki', format: 'der' });
    const fingerprint = createHash('sha256').update(der).digest('hex').slice(0, 16);
    const jwk = publicKey.export({ format: 'jwk' }) as Record<string, unknown>;
    return {
      privateKey,
      publicKey,
      kid: fingerprint,
      fingerprint,
      jwk: {
        ...jwk,
        kid: fingerprint,
        alg: 'RS256',
        use: 'sig',
      },
    };
  } catch {
    return null;
  }
}

function b64urlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

export type OauthAccessClaims = {
  iss: string;
  sub: string;
  aud: string;
  exp: number;
  nbf: number;
  iat: number;
  scope: string;
  grant_id: string;
  client_id: string;
};

export function signOauthAccessToken(
  material: OauthSigningMaterial,
  claims: OauthAccessClaims,
): string {
  const header = b64urlJson({ alg: 'RS256', typ: 'JWT', kid: material.kid });
  const payload = b64urlJson(claims);
  const data = `${header}.${payload}`;
  const signer = createSign('RSA-SHA256');
  signer.update(data);
  signer.end();
  const signature = signer.sign(material.privateKey).toString('base64url');
  return `${data}.${signature}`;
}

export function verifyOauthAccessToken(
  material: OauthSigningMaterial,
  token: string,
  expected: { issuer: string; audience: string; now?: number },
): OauthAccessClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }
  const [header, payload, signature] = parts;
  if (!header || !payload || !signature) {
    return null;
  }
  const verifier = createVerify('RSA-SHA256');
  verifier.update(`${header}.${payload}`);
  verifier.end();
  const ok = verifier.verify(material.publicKey, Buffer.from(signature, 'base64url'));
  if (!ok) {
    return null;
  }
  let claims: OauthAccessClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as OauthAccessClaims;
  } catch {
    return null;
  }
  const now = expected.now ?? Math.floor(Date.now() / 1000);
  if (claims.iss !== expected.issuer || claims.aud !== expected.audience) {
    return null;
  }
  if (typeof claims.exp !== 'number' || claims.exp < now - 30) {
    return null;
  }
  if (typeof claims.nbf === 'number' && claims.nbf > now + 30) {
    return null;
  }
  if (!claims.sub || !claims.grant_id) {
    return null;
  }
  return claims;
}
