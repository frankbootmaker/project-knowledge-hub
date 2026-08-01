import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireSystemAdmin } from '@project-knowledge-hub/permissions';
import {
  assertMutatingOrigin,
  requireAuthenticated,
} from '../plugins/auth.js';
import { getDefaultOrganization, writeAuditEvent } from '../lib/identity.js';
import {
  createLlmProvider,
  createLlmProviderSchema,
  deleteLlmProvider,
  getLlmCapabilities,
  listPublicLlmBindings,
  listPublicLlmProviders,
  putLlmBindingsSchema,
  putLlmServiceBindings,
  testLlmProvider,
  updateLlmProvider,
  updateLlmProviderSchema,
} from '../lib/llm-providers.js';

export async function registerLlmProviderRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get('/api/v1/llm/capabilities', async (request) => {
    requireAuthenticated(request);
    return getLlmCapabilities(app.database, app.env);
  });

  app.get('/api/v1/admin/llm-providers', async (request) => {
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);
    const [providers, bindings] = await Promise.all([
      listPublicLlmProviders(app.database),
      listPublicLlmBindings(app.database, app.env),
    ]);
    return { providers, bindings };
  });

  app.post('/api/v1/admin/llm-providers', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);
    const body = createLlmProviderSchema.parse(request.body);
    const provider = await createLlmProvider(
      app.database,
      body,
      principal.userId,
    );

    const organization = await getDefaultOrganization(app.database);
    await writeAuditEvent(app.database, {
      organizationId: organization?.id ?? null,
      actorType: 'user',
      actorId: principal.userId,
      action: 'llm_provider.create',
      entityType: 'llm_provider',
      entityId: provider.id,
      metadata: {
        name: provider.name,
        baseUrl: provider.baseUrl,
        defaultModel: provider.defaultModel,
      },
      ipAddress: request.ip,
    });

    return { provider };
  });

  app.patch('/api/v1/admin/llm-providers/:providerId', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);
    const params = z.object({ providerId: z.string().uuid() }).parse(request.params);
    const body = updateLlmProviderSchema.parse(request.body);
    const provider = await updateLlmProvider(
      app.database,
      params.providerId,
      body,
      principal.userId,
    );

    const organization = await getDefaultOrganization(app.database);
    await writeAuditEvent(app.database, {
      organizationId: organization?.id ?? null,
      actorType: 'user',
      actorId: principal.userId,
      action: 'llm_provider.update',
      entityType: 'llm_provider',
      entityId: provider.id,
      metadata: {
        name: provider.name,
        status: provider.status,
        defaultModel: provider.defaultModel,
      },
      ipAddress: request.ip,
    });

    return { provider };
  });

  app.delete('/api/v1/admin/llm-providers/:providerId', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);
    const params = z.object({ providerId: z.string().uuid() }).parse(request.params);
    await deleteLlmProvider(app.database, params.providerId);

    const organization = await getDefaultOrganization(app.database);
    await writeAuditEvent(app.database, {
      organizationId: organization?.id ?? null,
      actorType: 'user',
      actorId: principal.userId,
      action: 'llm_provider.delete',
      entityType: 'llm_provider',
      entityId: params.providerId,
      metadata: {},
      ipAddress: request.ip,
    });

    return { ok: true };
  });

  app.post('/api/v1/admin/llm-providers/:providerId/test', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);
    const params = z.object({ providerId: z.string().uuid() }).parse(request.params);
    const result = await testLlmProvider(
      app.database,
      app.env,
      params.providerId,
    );

    const organization = await getDefaultOrganization(app.database);
    await writeAuditEvent(app.database, {
      organizationId: organization?.id ?? null,
      actorType: 'user',
      actorId: principal.userId,
      action: 'llm_provider.test',
      entityType: 'llm_provider',
      entityId: params.providerId,
      metadata: { model: result.model },
      ipAddress: request.ip,
    });

    return result;
  });

  app.get('/api/v1/admin/llm-service-bindings', async (request) => {
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);
    const bindings = await listPublicLlmBindings(app.database, app.env);
    return { bindings };
  });

  app.put('/api/v1/admin/llm-service-bindings', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);
    const body = putLlmBindingsSchema.parse(request.body);
    const bindings = await putLlmServiceBindings(
      app.database,
      app.env,
      body,
      principal.userId,
    );

    const organization = await getDefaultOrganization(app.database);
    await writeAuditEvent(app.database, {
      organizationId: organization?.id ?? null,
      actorType: 'user',
      actorId: principal.userId,
      action: 'llm_binding.update',
      entityType: 'llm_service_binding',
      entityId: null,
      metadata: {
        bindings: bindings
          .filter((row) => row.active)
          .map((row) => ({
            service: row.service,
            providerId: row.providerId,
            modelOverride: row.modelOverride,
            source: row.source,
          })),
      },
      ipAddress: request.ip,
    });

    return { bindings };
  });
}
