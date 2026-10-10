import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  readOauthSigningKey,
  signOauthAccessToken,
  verifyOauthAccessToken,
} from './oauth-jwt.js';

function testKey(): string {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
}

const claims = {
  iss: 'https://knowledge.example.com',
  sub: 'user-1',
  aud: 'https://knowledge.example.com/mcp/oauth',
  exp: Math.floor(Date.now() / 1000) + 600,
  nbf: Math.floor(Date.now() / 1000) - 10,
  iat: Math.floor(Date.now() / 1000),
  scope: 'knowledge:read',
  grant_id: 'grant-1',
  client_id: 'https://chatgpt.com/oauth/client.json',
};

describe('oauth jwt', () => {
  it('signs and verifies an access token for the OAuth resource audience', () => {
    const material = readOauthSigningKey(testKey());
    expect(material).not.toBeNull();
    const token = signOauthAccessToken(material!, claims);
    expect(token.startsWith('kh_')).toBe(false);
    const verified = verifyOauthAccessToken(material!, token, {
      issuer: claims.iss,
      audience: claims.aud,
    });
    expect(verified?.grant_id).toBe('grant-1');
    expect(
      verifyOauthAccessToken(material!, token, {
        issuer: claims.iss,
        audience: 'https://knowledge.example.com/mcp',
      }),
    ).toBeNull();
  });

  it('rejects a bearer API token shape', () => {
    const material = readOauthSigningKey(testKey());
    expect(
      verifyOauthAccessToken(material!, 'kh_not_a_jwt', {
        issuer: claims.iss,
        audience: claims.aud,
      }),
    ).toBeNull();
  });
});
