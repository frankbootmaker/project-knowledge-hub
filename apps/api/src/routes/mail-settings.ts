import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '@project-knowledge-hub/domain';
import { requireSystemAdmin } from '@project-knowledge-hub/permissions';
import {
  assertMutatingOrigin,
  requireAuthenticated,
} from '../plugins/auth.js';
import { getDefaultOrganization, writeAuditEvent } from '../lib/identity.js';
import {
  clearStoredMailSettings,
  getPublicMailSettings,
  MAIL_SETTINGS_KEY,
  resolveMailConfig,
  setStoredMailSettings,
} from '../lib/mail-settings.js';

const mailDriverSchema = z.enum(['console', 'smtp', 'resend']);

const updateMailSettingsSchema = z.object({
  driver: mailDriverSchema,
  from: z.string().min(1).max(320),
  smtpHost: z.string().max(320).optional(),
  smtpPort: z.coerce.number().int().positive().max(65535).optional(),
  smtpSecure: z.boolean().optional(),
  smtpUser: z.string().max(320).optional(),
  /** Omit to keep; empty string ignored; null clears. */
  smtpPass: z.string().max(500).nullable().optional(),
  resendApiKey: z.string().max(500).nullable().optional(),
});

const testMailSchema = z.object({
  to: z.string().email().optional(),
});

export async function registerMailSettingsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/admin/mail-settings', async (request) => {
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);
    const settings = await getPublicMailSettings(app.database, app.env);
    return { settings };
  });

  app.put('/api/v1/admin/mail-settings', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);
    const body = updateMailSettingsSchema.parse(request.body);

    const settings = await setStoredMailSettings(
      app.database,
      app.env,
      {
        driver: body.driver,
        from: body.from,
        smtpHost: body.smtpHost,
        smtpPort: body.smtpPort,
        smtpSecure: body.smtpSecure,
        smtpUser: body.smtpUser,
        smtpPass: body.smtpPass,
        resendApiKey: body.resendApiKey,
      },
      principal.userId,
    );

    const organization = await getDefaultOrganization(app.database);
    await writeAuditEvent(app.database, {
      organizationId: organization?.id ?? null,
      actorType: 'user',
      actorId: principal.userId,
      action: 'mail.settings_update',
      entityType: 'platform_settings',
      entityId: MAIL_SETTINGS_KEY,
      metadata: {
        driver: settings.driver,
        from: settings.from,
        smtpHost: settings.smtpHost || null,
        hasSmtpPass: settings.hasSmtpPass,
        hasResendApiKey: settings.hasResendApiKey,
      },
      ipAddress: request.ip,
    });

    return { settings };
  });

  app.delete('/api/v1/admin/mail-settings', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);

    await clearStoredMailSettings(app.database);

    const organization = await getDefaultOrganization(app.database);
    await writeAuditEvent(app.database, {
      organizationId: organization?.id ?? null,
      actorType: 'user',
      actorId: principal.userId,
      action: 'mail.settings_clear',
      entityType: 'platform_settings',
      entityId: MAIL_SETTINGS_KEY,
      ipAddress: request.ip,
    });

    const settings = await getPublicMailSettings(app.database, app.env);
    return { settings };
  });

  app.post('/api/v1/admin/mail-settings/test', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);
    const body = testMailSchema.parse(request.body ?? {});
    const to = body.to?.toLowerCase() ?? principal.email;

    const { config, source } = await resolveMailConfig(app.database, app.env);
    const result = await app.mail.send({
      to,
      subject: 'Project Knowledge Hub — test email',
      text: [
        'This is a test message from Project Knowledge Hub.',
        `Driver: ${config.driver}`,
        `Source: ${source}`,
        `From: ${config.from}`,
      ].join('\n'),
      html: `<p>This is a test message from Project Knowledge Hub.</p>
<p>Driver: <code>${config.driver}</code><br/>Source: <code>${source}</code></p>`,
    });

    if (!result.ok) {
      throw new AppError({
        code: 'MAIL_TEST_FAILED',
        message: result.error ?? 'Failed to send test email',
        statusCode: 502,
      });
    }

    const organization = await getDefaultOrganization(app.database);
    await writeAuditEvent(app.database, {
      organizationId: organization?.id ?? null,
      actorType: 'user',
      actorId: principal.userId,
      action: 'mail.test_send',
      entityType: 'platform_settings',
      entityId: MAIL_SETTINGS_KEY,
      metadata: { to, driver: result.driver, source },
      ipAddress: request.ip,
    });

    return {
      ok: true,
      to,
      driver: result.driver,
      source,
      warning:
        result.driver === 'console'
          ? 'Email logged to the API console (console driver).'
          : undefined,
    };
  });
}
