import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { users } from '@project-knowledge-hub/database';
import { AppError } from '@project-knowledge-hub/domain';
import {
  buildAiDiscoverDocument,
  claimAiDiscoverRequest,
  createAiDiscoverRequest,
} from '../lib/ai-discover.js';
import { sendAiConnectionPendingMail } from '../lib/auth-mail.js';
import { writeAuditEvent } from '../lib/identity.js';
import { shouldSendOptionalEmail } from '../lib/notification-prefs.js';
import { MemoryRateLimiter } from '../lib/rate-limit.js';

const requestLimiter = new MemoryRateLimiter(20, 15 * 60 * 1000);
const claimLimiter = new MemoryRateLimiter(60, 15 * 60 * 1000);

const createRequestSchema = z.object({
  pairingCode: z.string().min(8).max(64),
  name: z.string().min(1).max(160),
  description: z.string().max(1000).nullable().optional(),
  agentLabel: z.string().max(64).nullable().optional(),
  requestWrite: z.boolean().optional(),
});

export async function registerAiDiscoverRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/ai-discover', async () => {
    return buildAiDiscoverDocument(app.database, app.env);
  });

  app.post('/api/v1/ai-discover/requests', async (request) => {
    const ip = request.ip ?? 'unknown';
    if (!requestLimiter.allow(`ai-discover-request:${ip}`)) {
      throw new AppError({
        code: 'RATE_LIMITED',
        message: 'Too many AI discover requests. Try again later.',
        statusCode: 429,
      });
    }

    const body = createRequestSchema.parse(request.body);
    const created = await createAiDiscoverRequest(app.database, {
      pairingCode: body.pairingCode,
      name: body.name,
      description: body.description,
      agentLabel: body.agentLabel,
      requestWrite: body.requestWrite,
    });

    await writeAuditEvent(app.database, {
      organizationId: created.apiClient.organizationId,
      actorType: 'system',
      actorId: created.apiClient.requestedByUserId,
      action: 'api_client.request',
      entityType: 'api_client',
      entityId: created.requestId,
      metadata: {
        name: created.apiClient.name,
        agentLabel: created.apiClient.agentLabel,
      },
      ipAddress: request.ip,
    });

    if (created.apiClient.requestedByUserId) {
      const [owner] = await app.database.db
        .select()
        .from(users)
        .where(eq(users.id, created.apiClient.requestedByUserId))
        .limit(1);
      if (owner && shouldSendOptionalEmail(owner.emailNotificationPrefs, 'aiConnectionPending')) {
        await sendAiConnectionPendingMail(app.mail, {
          webUrl: app.env.WEB_URL,
          to: owner.email,
          displayName: owner.displayName,
          agentName: created.apiClient.agentLabel ?? created.apiClient.name,
          locale: owner.preferredLocale,
        });
      }
    }

    const publicApiBase = app.env.WEB_URL.replace(/\/$/, '');
    const pollUrl =
      `${publicApiBase}/api/v1/ai-discover/requests/${created.requestId}` +
      `?claimSecret=${encodeURIComponent(created.claimSecret)}`;

    return {
      requestId: created.requestId,
      claimSecret: created.claimSecret,
      status: created.status,
      apiClient: created.apiClient,
      pollUrl,
      pollHint: `Poll GET ${pollUrl} until status is active`,
    };
  });

  app.get('/api/v1/ai-discover/requests/:requestId', async (request) => {
    const ip = request.ip ?? 'unknown';
    if (!claimLimiter.allow(`ai-discover-claim:${ip}`)) {
      throw new AppError({
        code: 'RATE_LIMITED',
        message: 'Too many claim polls. Try again later.',
        statusCode: 429,
      });
    }

    const params = z.object({ requestId: z.string().uuid() }).parse(request.params);
    const query = z
      .object({ claimSecret: z.string().min(16).max(200) })
      .parse(request.query);

    return claimAiDiscoverRequest(app.database, app.env, {
      requestId: params.requestId,
      claimSecret: query.claimSecret,
    });
  });
}
