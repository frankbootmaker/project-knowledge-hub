import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireSystemAdmin } from '@project-knowledge-hub/permissions';
import {
  assertMutatingOrigin,
  requireAuthenticated,
} from '../plugins/auth.js';
import { getDefaultOrganization, writeAuditEvent } from '../lib/identity.js';
import {
  BRAND_IDS,
  BRAND_SETTINGS_KEY,
  getBrandSettings,
  setBrandSettings,
} from '../lib/brand-settings.js';

const updateBrandSettingsSchema = z.object({
  defaultBrand: z.enum(BRAND_IDS),
  locked: z.boolean(),
});

export async function registerBrandSettingsRoutes(
  app: FastifyInstance,
): Promise<void> {
  /** Public — used by the web shell before paint / without a session. */
  app.get('/api/v1/brand-settings', async () => {
    const settings = await getBrandSettings(app.database);
    return { settings };
  });

  app.get('/api/v1/admin/brand-settings', async (request) => {
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);
    const settings = await getBrandSettings(app.database);
    return { settings };
  });

  app.put('/api/v1/admin/brand-settings', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);
    const body = updateBrandSettingsSchema.parse(request.body);

    const settings = await setBrandSettings(
      app.database,
      {
        defaultBrand: body.defaultBrand,
        locked: body.locked,
      },
      principal.userId,
    );

    const organization = await getDefaultOrganization(app.database);
    await writeAuditEvent(app.database, {
      organizationId: organization?.id ?? null,
      actorType: 'user',
      actorId: principal.userId,
      action: 'brand.settings_update',
      entityType: 'platform_settings',
      entityId: BRAND_SETTINGS_KEY,
      metadata: {
        defaultBrand: settings.defaultBrand,
        locked: settings.locked,
      },
      ipAddress: request.ip,
    });

    return { settings };
  });
}
