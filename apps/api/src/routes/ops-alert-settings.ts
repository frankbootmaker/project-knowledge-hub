import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  OPS_ALERT_SETTINGS_KEY,
  OPS_ALERT_TYPES,
  clearStoredOpsAlertSettings,
  listActiveAdminRecipients,
  listRecipientUsers,
  loadEffectiveAlertSettings,
  mergeStoredOpsAlertSettings,
  recipientsFromSpec,
  saveStoredOpsAlertSettings,
  type OpsAlertType,
} from '@project-knowledge-hub/database';
import { AppError } from '@project-knowledge-hub/domain';
import {
  adminMonitoringUrl,
  getMailMessages,
  interpolate,
  normalizeAppLocale,
  opsAlertEmail,
} from '@project-knowledge-hub/mail';
import { requireSystemAdmin } from '@project-knowledge-hub/permissions';
import {
  assertMutatingOrigin,
  requireAuthenticated,
} from '../plugins/auth.js';
import { getDefaultOrganization, writeAuditEvent } from '../lib/identity.js';
import { resolveMailConfig } from '../lib/mail-settings.js';
import {
  getOpsAlertAdminView,
} from '../lib/ops-alert-admin.js';

const recipientSchema = z.object({
  configured: z.boolean(),
  userIds: z.array(z.string().uuid()).max(100),
  emails: z.array(z.string().email().max(320)).max(20),
});

const recipientsSchema = z.object({
  'backup.stale': recipientSchema,
  'backup.fail': recipientSchema,
  'offsite.stale': recipientSchema,
  'offsite.error': recipientSchema,
  'rotation.error': recipientSchema,
  'api.error_spike': recipientSchema,
  'disk.low': recipientSchema,
});

const updateSchema = z.object({
  diskFreeRatioMin: z.coerce.number().min(0).max(1).optional(),
  diskFreeGbMin: z.coerce.number().min(0).max(100000).optional(),
  staleAfterHours: z.coerce.number().int().min(1).max(168).optional(),
  offsiteStaleAfterHours: z.coerce.number().int().min(1).max(24 * 30).optional(),
  errorSpikeThreshold: z.coerce.number().int().min(0).max(1_000_000).optional(),
  errorSpikeWindowMinutes: z.coerce.number().int().min(1).max(1440).optional(),
  webhookMode: z.enum(['env', 'custom', 'disabled']).optional(),
  webhookUrl: z.string().max(2000).optional(),
  auditRetentionDays: z.union([
    z.null(),
    z.coerce.number().int().min(0).max(3650),
  ]).optional(),
  recipients: recipientsSchema.optional(),
}).superRefine((value, ctx) => {
  const present = Object.entries(value).some(([, item]) => item !== undefined);
  if (!present) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'At least one setting is required',
    });
  }
  if (value.webhookMode !== 'custom') return;
  const url = value.webhookUrl?.trim() ?? '';
  if (!url) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['webhookUrl'],
      message: 'Webhook URL is required when webhook mode is custom',
    });
    return;
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error('bad protocol');
    }
  } catch {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['webhookUrl'],
      message: 'Webhook URL must be an http(s) URL',
    });
  }
});

const testSchema = z.object({
  type: z.enum(OPS_ALERT_TYPES).default('disk.low'),
});

function normalizeRecipients(
  recipients: z.infer<typeof recipientsSchema>,
): z.infer<typeof recipientsSchema> {
  const next = { ...recipients };
  for (const type of OPS_ALERT_TYPES) {
    const spec = recipients[type];
    const emails = [...new Set(spec.emails.map((email) => email.trim().toLowerCase()))];
    const userIds = [...new Set(spec.userIds)];
    next[type] = { ...spec, emails, userIds };
  }
  return next;
}

export async function registerOpsAlertSettingsRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get('/api/v1/admin/monitoring/alerts', async (request) => {
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);
    const settings = await getOpsAlertAdminView(
      app.database,
      app.env,
      app.env.BACKUP_DIR,
    );
    return { settings };
  });

  app.put('/api/v1/admin/monitoring/alerts', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);
    const body = updateSchema.parse(request.body);
    const { stored: existing } = await loadEffectiveAlertSettings(app.database, app.env);
    const stored = mergeStoredOpsAlertSettings(existing, {
      ...body,
      recipients: body.recipients ? normalizeRecipients(body.recipients) : undefined,
    });
    if (stored) {
      await saveStoredOpsAlertSettings(app.database, stored, principal.userId);
    } else {
      await clearStoredOpsAlertSettings(app.database);
    }

    const organization = await getDefaultOrganization(app.database);
    const configuredTypes = OPS_ALERT_TYPES.filter(
      (type) => stored?.recipients?.[type]?.configured,
    );
    await writeAuditEvent(app.database, {
      organizationId: organization?.id ?? null,
      actorType: 'user',
      actorId: principal.userId,
      action: 'monitoring.alert_settings_update',
      entityType: 'platform_settings',
      entityId: OPS_ALERT_SETTINGS_KEY,
      metadata: {
        diskFreeRatioMin: stored?.diskFreeRatioMin,
        diskFreeGbMin: stored?.diskFreeGbMin,
        staleAfterHours: stored?.staleAfterHours,
        offsiteStaleAfterHours: stored?.offsiteStaleAfterHours,
        errorSpikeThreshold: stored?.errorSpikeThreshold,
        webhookMode: stored?.webhookMode,
        auditRetentionDays: stored?.auditRetentionDays,
        configuredTypes,
      },
      ipAddress: request.ip,
    });

    const settings = await getOpsAlertAdminView(
      app.database,
      app.env,
      app.env.BACKUP_DIR,
    );
    return { settings };
  });

  app.delete('/api/v1/admin/monitoring/alerts', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);
    await clearStoredOpsAlertSettings(app.database);

    const organization = await getDefaultOrganization(app.database);
    await writeAuditEvent(app.database, {
      organizationId: organization?.id ?? null,
      actorType: 'user',
      actorId: principal.userId,
      action: 'monitoring.alert_settings_clear',
      entityType: 'platform_settings',
      entityId: OPS_ALERT_SETTINGS_KEY,
      ipAddress: request.ip,
    });

    const settings = await getOpsAlertAdminView(
      app.database,
      app.env,
      app.env.BACKUP_DIR,
    );
    return { settings };
  });

  app.post('/api/v1/admin/monitoring/alerts/test', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);
    const body = testSchema.parse(request.body ?? {});
    const type = body.type as OpsAlertType;

    const { stored } = await loadEffectiveAlertSettings(app.database, app.env);
    const [admins, selected] = await Promise.all([
      listActiveAdminRecipients(app.database),
      listRecipientUsers(app.database, stored?.recipients?.[type]?.userIds ?? []),
    ]);
    const plan = recipientsFromSpec({
      spec: stored?.recipients?.[type],
      admins,
      selectedUsers: selected,
    });
    if (plan.recipients.length === 0) {
      throw new AppError({
        code: 'ALERT_NO_RECIPIENTS',
        message: 'This alert type has no recipients. Add someone or use all admins.',
        statusCode: 400,
      });
    }

    const { source } = await resolveMailConfig(app.database, app.env);
    const monitoringUrl = adminMonitoringUrl(app.env.WEB_URL);
    let driver = 'console';
    for (const recipient of plan.recipients) {
      const loc = normalizeAppLocale(recipient.preferredLocale);
      const copy = getMailMessages(loc).opsAlertTest;
      const content = opsAlertEmail({
        locale: recipient.preferredLocale,
        displayName: recipient.displayName,
        subject: copy.subject,
        title: copy.title,
        body: copy.body,
        detailLines: [interpolate(copy.typeLabel, { type })],
        monitoringUrl,
      });
      const result = await app.mail.send({
        to: recipient.email,
        subject: content.subject,
        text: content.text,
        html: content.html,
      });
      driver = result.driver;
      if (!result.ok) {
        throw new AppError({
          code: 'ALERT_TEST_FAILED',
          message: result.error ?? 'Failed to send test alert',
          statusCode: 502,
        });
      }
    }

    const organization = await getDefaultOrganization(app.database);
    await writeAuditEvent(app.database, {
      organizationId: organization?.id ?? null,
      actorType: 'user',
      actorId: principal.userId,
      action: 'monitoring.alert_test',
      entityType: 'platform_settings',
      entityId: OPS_ALERT_SETTINGS_KEY,
      metadata: {
        type,
        recipientCount: plan.recipients.length,
        driver,
        source,
      },
      ipAddress: request.ip,
    });

    return {
      ok: true,
      type,
      recipientCount: plan.recipients.length,
      driver,
      source,
      warning: driver === 'console'
        ? 'Alert logged to the server console (console mail driver).'
        : undefined,
    };
  });
}
