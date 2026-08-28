import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireSystemAdmin } from '@project-knowledge-hub/permissions';
import {
  assertMutatingOrigin,
  requireAuthenticated,
} from '../plugins/auth.js';
import { getDefaultOrganization, writeAuditEvent } from '../lib/identity.js';
import { clearOidcConfigurationCache } from '../lib/oidc-client.js';
import {
  clearStoredOidcSettings,
  getPublicOidcSettings,
  OIDC_SETTINGS_KEY,
  setStoredOidcSettings,
} from '../lib/oidc-settings.js';

const updateOidcSettingsSchema = z.object({
  enabled: z.boolean(),
  issuer: z.string().max(500).optional(),
  clientId: z.string().max(320).optional(),
  /** Omit to keep; empty string or null clears. */
  clientSecret: z.string().max(500).nullable().optional(),
  buttonLabel: z.string().max(80).optional(),
  idpSource: z.string().max(64).optional(),
  redirectUri: z.string().max(500).nullable().optional(),
  jitProvisioning: z.boolean().optional(),
});

export async function registerOidcSettingsRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get('/api/v1/admin/oidc-settings', async (request) => {
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);
    const settings = await getPublicOidcSettings(app.database, app.env);
    return { settings };
  });

  app.put('/api/v1/admin/oidc-settings', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);
    const body = updateOidcSettingsSchema.parse(request.body);

    const settings = await setStoredOidcSettings(
      app.database,
      app.env,
      {
        enabled: body.enabled,
        issuer: body.issuer,
        clientId: body.clientId,
        clientSecret: body.clientSecret,
        buttonLabel: body.buttonLabel,
        idpSource: body.idpSource,
        redirectUri: body.redirectUri,
        jitProvisioning: body.jitProvisioning,
      },
      principal.userId,
    );
    clearOidcConfigurationCache();

    const organization = await getDefaultOrganization(app.database);
    await writeAuditEvent(app.database, {
      organizationId: organization?.id ?? null,
      actorType: 'user',
      actorId: principal.userId,
      action: 'oidc.settings_update',
      entityType: 'platform_settings',
      entityId: OIDC_SETTINGS_KEY,
      metadata: {
        enabled: settings.enabled,
        issuer: settings.issuer || null,
        clientId: settings.clientId || null,
        jitProvisioning: settings.jitProvisioning,
        hasClientSecret: settings.hasClientSecret,
        effectiveEnabled: settings.effectiveEnabled,
      },
      ipAddress: request.ip,
    });

    return { settings };
  });

  app.delete('/api/v1/admin/oidc-settings', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);

    await clearStoredOidcSettings(app.database);
    clearOidcConfigurationCache();

    const organization = await getDefaultOrganization(app.database);
    await writeAuditEvent(app.database, {
      organizationId: organization?.id ?? null,
      actorType: 'user',
      actorId: principal.userId,
      action: 'oidc.settings_clear',
      entityType: 'platform_settings',
      entityId: OIDC_SETTINGS_KEY,
      ipAddress: request.ip,
    });

    const settings = await getPublicOidcSettings(app.database, app.env);
    return { settings };
  });
}
