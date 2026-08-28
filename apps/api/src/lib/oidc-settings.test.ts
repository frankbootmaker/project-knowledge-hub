import { describe, expect, it } from 'vitest';
import type { AppEnv } from '@project-knowledge-hub/config';
import type { Database } from '@project-knowledge-hub/database';
import {
  getPublicOidcSettings,
  resolveOidcConfig,
  type StoredOidcSettings,
} from './oidc-settings.js';

function env(overrides: Partial<AppEnv> = {}): AppEnv {
  return {
    WEB_URL: 'http://localhost:3100',
    OIDC_ISSUER: undefined,
    OIDC_CLIENT_ID: undefined,
    OIDC_CLIENT_SECRET: undefined,
    OIDC_BUTTON_LABEL: 'Sign in with SSO',
    OIDC_IDP_SOURCE: 'oidc',
    OIDC_REDIRECT_URI: undefined,
    OIDC_JIT_PROVISIONING: false,
    ...overrides,
  } as AppEnv;
}

function databaseWithStored(stored: StoredOidcSettings | null): Database {
  return {
    db: {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () =>
              stored ? [{ value: JSON.stringify(stored) }] : [],
          }),
        }),
      }),
    },
  } as unknown as Database;
}

const envComplete = env({
  OIDC_ISSUER: 'https://auth.example.com/application/o/knowhub/',
  OIDC_CLIENT_ID: 'env-client',
  OIDC_CLIENT_SECRET: 'env-secret',
  OIDC_BUTTON_LABEL: 'Sign in with Authentik',
  OIDC_IDP_SOURCE: 'authentik',
  OIDC_JIT_PROVISIONING: false,
});

describe('resolveOidcConfig', () => {
  it('uses env when no platform override is stored', async () => {
    const { config, source } = await resolveOidcConfig(
      databaseWithStored(null),
      envComplete,
    );
    expect(source).toBe('env');
    expect(config).toMatchObject({
      issuer: envComplete.OIDC_ISSUER,
      clientId: 'env-client',
      clientSecret: 'env-secret',
      jitProvisioning: false,
    });
  });

  it('prefers stored issuer, secret, and JIT over env', async () => {
    const { config, source } = await resolveOidcConfig(
      databaseWithStored({
        enabled: true,
        issuer: 'https://idp.example.org/',
        clientId: 'ui-client',
        clientSecret: 'ui-secret',
        buttonLabel: 'Company SSO',
        idpSource: 'entra',
        jitProvisioning: true,
      }),
      envComplete,
    );
    expect(source).toBe('override');
    expect(config).toMatchObject({
      issuer: 'https://idp.example.org/',
      clientId: 'ui-client',
      clientSecret: 'ui-secret',
      buttonLabel: 'Company SSO',
      idpSource: 'entra',
      jitProvisioning: true,
    });
  });

  it('disables SSO when the stored toggle is off even if env is complete', async () => {
    const { config, source } = await resolveOidcConfig(
      databaseWithStored({
        enabled: false,
        issuer: 'https://idp.example.org/',
        clientId: 'ui-client',
        clientSecret: 'ui-secret',
      }),
      envComplete,
    );
    expect(source).toBe('override');
    expect(config).toBeNull();
  });
});

describe('getPublicOidcSettings', () => {
  it('never returns the client secret', async () => {
    const settings = await getPublicOidcSettings(
      databaseWithStored({
        enabled: true,
        issuer: 'https://idp.example.org/',
        clientId: 'ui-client',
        clientSecret: 'super-secret-value',
        jitProvisioning: true,
      }),
      envComplete,
    );
    expect(settings).not.toHaveProperty('clientSecret');
    expect(JSON.stringify(settings)).not.toContain('super-secret-value');
    expect(JSON.stringify(settings)).not.toContain('env-secret');
    expect(settings.hasClientSecret).toBe(true);
    expect(settings.jitProvisioning).toBe(true);
    expect(settings.source).toBe('override');
    expect(settings.effectiveEnabled).toBe(true);

    const fromEnv = await getPublicOidcSettings(
      databaseWithStored(null),
      envComplete,
    );
    expect(fromEnv).not.toHaveProperty('clientSecret');
    expect(JSON.stringify(fromEnv)).not.toContain('env-secret');
    expect(fromEnv.hasClientSecret).toBe(true);
    expect(fromEnv.source).toBe('env');
  });

  it('exposes JIT from the store while falling back to env when unset', async () => {
    const fromStore = await getPublicOidcSettings(
      databaseWithStored({
        enabled: true,
        issuer: 'https://idp.example.org/',
        clientId: 'ui-client',
        clientSecret: 'ui-secret',
        jitProvisioning: true,
      }),
      env({ ...envComplete, OIDC_JIT_PROVISIONING: false }),
    );
    expect(fromStore.jitProvisioning).toBe(true);

    const fromEnv = await getPublicOidcSettings(
      databaseWithStored({
        enabled: true,
        issuer: 'https://idp.example.org/',
        clientId: 'ui-client',
        clientSecret: 'ui-secret',
      }),
      env({ ...envComplete, OIDC_JIT_PROVISIONING: true }),
    );
    expect(fromEnv.jitProvisioning).toBe(true);
  });
});
