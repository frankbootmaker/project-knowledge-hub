import type { FastifyInstance } from 'fastify';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import {
  knowledgeRecords,
  workspaces,
} from '@project-knowledge-hub/database';
import { AppError } from '@project-knowledge-hub/domain';
import { renderMarkdown } from '@project-knowledge-hub/markdown';
import {
  requireWorkspaceAdmin,
  requireWorkspaceMaintainer,
  requireWorkspaceView,
} from '@project-knowledge-hub/permissions';
import {
  assertMutatingOrigin,
  requireAuthenticated,
} from '../plugins/auth.js';
import { writeAuditEvent } from '../lib/identity.js';
import {
  ensureBaselineVersion,
  getVersion,
  insertVersionSnapshot,
  listVersions,
  supersedeOtherCurrentInSeries,
  toPublicVersion,
} from '../lib/knowledge-versions.js';
import { getKnowledgeRecordTags } from '../lib/tags.js';
import {
  createKnowledgeRecord,
  createRecordInputSchema,
  loadPrimarySource,
  toPublicRecord,
  updateKnowledgeRecord,
  updateRecordInputSchema,
} from '../lib/knowledge-records-service.js';

const restoreSchema = z.object({
  changeMessage: z.string().max(500).optional(),
});

export async function registerKnowledgeRecordRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/knowledge-records', async (request) => {
    const principal = requireAuthenticated(request);
    const query = z
      .object({
        workspaceId: z.string().uuid(),
        projectId: z.string().uuid().optional(),
        systemId: z.string().uuid().optional(),
        includeArchived: z
          .enum(['true', 'false'])
          .optional()
          .transform((value) => value === 'true'),
      })
      .parse(request.query);

    requireWorkspaceView(principal, query.workspaceId);

    const conditions = [eq(knowledgeRecords.workspaceId, query.workspaceId)];
    if (!query.includeArchived) {
      conditions.push(isNull(knowledgeRecords.archivedAt));
    }
    if (query.projectId) {
      conditions.push(eq(knowledgeRecords.projectId, query.projectId));
    }
    if (query.systemId) {
      conditions.push(eq(knowledgeRecords.systemId, query.systemId));
    }

    const rows = await app.database.db
      .select()
      .from(knowledgeRecords)
      .where(and(...conditions));

    const tagMap = await getKnowledgeRecordTags(
      app.database,
      rows.map((row) => row.id),
    );

    return {
      knowledgeRecords: rows.map((row) =>
        toPublicRecord(row, tagMap.get(row.id) ?? [], null),
      ),
    };
  });

  app.post('/api/v1/knowledge-records', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    const body = createRecordInputSchema.parse(request.body);
    requireWorkspaceMaintainer(principal, body.workspaceId);

    const result = await createKnowledgeRecord(
      app,
      body,
      {
        actorType: 'user',
        actorId: principal.userId,
        userId: principal.userId,
      },
      request.ip,
    );

    return { knowledgeRecord: result.knowledgeRecord };
  });

  app.get('/api/v1/knowledge-records/:recordId', async (request) => {
    const principal = requireAuthenticated(request);
    const params = z.object({ recordId: z.string().uuid() }).parse(request.params);
    const [record] = await app.database.db
      .select()
      .from(knowledgeRecords)
      .where(eq(knowledgeRecords.id, params.recordId))
      .limit(1);

    if (!record) {
      throw new AppError({
        code: 'KNOWLEDGE_RECORD_NOT_FOUND',
        message: 'Knowledge record not found',
        statusCode: 404,
      });
    }

    requireWorkspaceView(principal, record.workspaceId);
    const tagMap = await getKnowledgeRecordTags(app.database, [record.id]);
    const source = await loadPrimarySource(app.database, record.id);
    const rendered = await renderMarkdown(record.contentMarkdown);

    return {
      knowledgeRecord: toPublicRecord(record, tagMap.get(record.id) ?? [], source, {
        includeHtml: true,
        includeToc: true,
        html: rendered.html,
        toc: rendered.toc,
      }),
    };
  });

  app.patch('/api/v1/knowledge-records/:recordId', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    const params = z.object({ recordId: z.string().uuid() }).parse(request.params);
    const body = updateRecordInputSchema.parse(request.body);

    const [record] = await app.database.db
      .select()
      .from(knowledgeRecords)
      .where(eq(knowledgeRecords.id, params.recordId))
      .limit(1);

    if (!record) {
      throw new AppError({
        code: 'KNOWLEDGE_RECORD_NOT_FOUND',
        message: 'Knowledge record not found',
        statusCode: 404,
      });
    }

    requireWorkspaceMaintainer(principal, record.workspaceId);

    const result = await updateKnowledgeRecord(
      app,
      params.recordId,
      body,
      {
        actorType: 'user',
        actorId: principal.userId,
        userId: principal.userId,
      },
      request.ip,
    );

    return { knowledgeRecord: result.knowledgeRecord };
  });

  app.get('/api/v1/knowledge-records/:recordId/versions'
, async (request) => {
    const principal = requireAuthenticated(request);
    const params = z.object({ recordId: z.string().uuid() }).parse(request.params);
    const [record] = await app.database.db
      .select()
      .from(knowledgeRecords)
      .where(eq(knowledgeRecords.id, params.recordId))
      .limit(1);

    if (!record || record.archivedAt) {
      throw new AppError({
        code: 'KNOWLEDGE_RECORD_NOT_FOUND',
        message: 'Knowledge record not found',
        statusCode: 404,
      });
    }

    requireWorkspaceView(principal, record.workspaceId);
    await ensureBaselineVersion(app.database, record);
    const versions = await listVersions(app.database, record.id);
    return {
      versions: versions.map(toPublicVersion),
      currentVersionNumber: record.currentVersionNumber,
    };
  });

  app.get('/api/v1/knowledge-records/:recordId/versions/:versionNumber', async (request) => {
    const principal = requireAuthenticated(request);
    const params = z
      .object({
        recordId: z.string().uuid(),
        versionNumber: z.coerce.number().int().positive(),
      })
      .parse(request.params);

    const [record] = await app.database.db
      .select()
      .from(knowledgeRecords)
      .where(eq(knowledgeRecords.id, params.recordId))
      .limit(1);

    if (!record || record.archivedAt) {
      throw new AppError({
        code: 'KNOWLEDGE_RECORD_NOT_FOUND',
        message: 'Knowledge record not found',
        statusCode: 404,
      });
    }

    requireWorkspaceView(principal, record.workspaceId);
    const version = await getVersion(app.database, record.id, params.versionNumber);
    if (!version) {
      throw new AppError({
        code: 'KNOWLEDGE_VERSION_NOT_FOUND',
        message: 'Version not found',
        statusCode: 404,
      });
    }

    const rendered = await renderMarkdown(version.contentMarkdown);
    return {
      version: {
        ...toPublicVersion(version),
        contentHtml: rendered.html,
        toc: rendered.toc,
        isCurrent: version.versionNumber === record.currentVersionNumber,
        isHistorical: version.versionNumber !== record.currentVersionNumber,
      },
    };
  });

  app.post('/api/v1/knowledge-records/:recordId/versions/:versionNumber/restore', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    const params = z
      .object({
        recordId: z.string().uuid(),
        versionNumber: z.coerce.number().int().positive(),
      })
      .parse(request.params);
    const body = restoreSchema.parse(request.body ?? {});

    const [record] = await app.database.db
      .select()
      .from(knowledgeRecords)
      .where(eq(knowledgeRecords.id, params.recordId))
      .limit(1);

    if (!record || record.archivedAt) {
      throw new AppError({
        code: 'KNOWLEDGE_RECORD_NOT_FOUND',
        message: 'Knowledge record not found',
        statusCode: 404,
      });
    }

    requireWorkspaceMaintainer(principal, record.workspaceId);
    await ensureBaselineVersion(app.database, record);

    const version = await getVersion(app.database, record.id, params.versionNumber);
    if (!version) {
      throw new AppError({
        code: 'KNOWLEDGE_VERSION_NOT_FOUND',
        message: 'Version not found',
        statusCode: 404,
      });
    }

    const nextVersionNumber = record.currentVersionNumber + 1;
    const rendered = await renderMarkdown(version.contentMarkdown);
    const now = new Date();

    const [updated] = await app.database.db
      .update(knowledgeRecords)
      .set({
        title: version.title,
        summary: version.summary,
        recordType: version.recordType,
        contentMarkdown: version.contentMarkdown,
        contentHtmlCache: rendered.html,
        metadataJson: version.metadataJson,
        currentVersionNumber: nextVersionNumber,
        updatedAt: now,
      })
      .where(eq(knowledgeRecords.id, record.id))
      .returning();

    if (!updated) {
      throw new AppError({
        code: 'KNOWLEDGE_RECORD_RESTORE_FAILED',
        message: 'Failed to restore version',
        statusCode: 500,
      });
    }

    await insertVersionSnapshot(app.database, {
      knowledgeRecordId: updated.id,
      versionNumber: nextVersionNumber,
      title: updated.title,
      summary: updated.summary,
      recordType: updated.recordType,
      lifecycleStatus: updated.lifecycleStatus,
      contentMarkdown: updated.contentMarkdown,
      metadataJson: updated.metadataJson,
      changeMessage:
        body.changeMessage ?? `Restored from version ${params.versionNumber}`,
      createdBy: principal.userId,
    });

    const [workspace] = await app.database.db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, record.workspaceId))
      .limit(1);

    await writeAuditEvent(app.database, {
      organizationId: workspace?.organizationId ?? null,
      actorType: 'user',
      actorId: principal.userId,
      action: 'knowledge_record.restore',
      entityType: 'knowledge_record',
      entityId: updated.id,
      metadata: {
        restoredFrom: params.versionNumber,
        versionNumber: nextVersionNumber,
      },
      ipAddress: request.ip,
    });

    const tagMap = await getKnowledgeRecordTags(app.database, [updated.id]);
    const source = await loadPrimarySource(app.database, updated.id);
    return {
      knowledgeRecord: toPublicRecord(updated, tagMap.get(updated.id) ?? [], source, {
        includeHtml: true,
        includeToc: true,
        html: rendered.html,
        toc: rendered.toc,
      }),
    };
  });

  app.post('/api/v1/knowledge-records/:recordId/verify', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    const params = z.object({ recordId: z.string().uuid() }).parse(request.params);

    const [record] = await app.database.db
      .select()
      .from(knowledgeRecords)
      .where(eq(knowledgeRecords.id, params.recordId))
      .limit(1);

    if (!record || record.archivedAt) {
      throw new AppError({
        code: 'KNOWLEDGE_RECORD_NOT_FOUND',
        message: 'Knowledge record not found',
        statusCode: 404,
      });
    }

    requireWorkspaceMaintainer(principal, record.workspaceId);
    const now = new Date();

    const [updated] = await app.database.db
      .update(knowledgeRecords)
      .set({
        lifecycleStatus: 'verified',
        reviewedBy: principal.userId,
        verifiedAt: now,
        updatedAt: now,
      })
      .where(eq(knowledgeRecords.id, record.id))
      .returning();

    if (!updated) {
      throw new AppError({
        code: 'KNOWLEDGE_RECORD_VERIFY_FAILED',
        message: 'Failed to verify knowledge record',
        statusCode: 500,
      });
    }

    const [workspace] = await app.database.db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, record.workspaceId))
      .limit(1);

    await writeAuditEvent(app.database, {
      organizationId: workspace?.organizationId ?? null,
      actorType: 'user',
      actorId: principal.userId,
      action: 'knowledge_record.verify',
      entityType: 'knowledge_record',
      entityId: updated.id,
      ipAddress: request.ip,
    });

    const tagMap = await getKnowledgeRecordTags(app.database, [updated.id]);
    const source = await loadPrimarySource(app.database, updated.id);
    const rendered = await renderMarkdown(updated.contentMarkdown);
    return {
      knowledgeRecord: toPublicRecord(updated, tagMap.get(updated.id) ?? [], source, {
        includeHtml: true,
        includeToc: true,
        html: rendered.html,
        toc: rendered.toc,
      }),
    };
  });

  app.post('/api/v1/knowledge-records/:recordId/mark-current', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    const params = z.object({ recordId: z.string().uuid() }).parse(request.params);

    const [record] = await app.database.db
      .select()
      .from(knowledgeRecords)
      .where(eq(knowledgeRecords.id, params.recordId))
      .limit(1);

    if (!record || record.archivedAt) {
      throw new AppError({
        code: 'KNOWLEDGE_RECORD_NOT_FOUND',
        message: 'Knowledge record not found',
        statusCode: 404,
      });
    }

    requireWorkspaceMaintainer(principal, record.workspaceId);

    const superseded = await supersedeOtherCurrentInSeries(app.database, record);
    const now = new Date();

    const [updated] = await app.database.db
      .update(knowledgeRecords)
      .set({
        lifecycleStatus: 'current',
        supersedesRecordId:
          superseded.length > 0
            ? (superseded[superseded.length - 1]?.id ?? record.supersedesRecordId)
            : record.supersedesRecordId,
        reviewedBy: record.reviewedBy ?? principal.userId,
        verifiedAt: record.verifiedAt ?? now,
        updatedAt: now,
      })
      .where(eq(knowledgeRecords.id, record.id))
      .returning();

    if (!updated) {
      throw new AppError({
        code: 'KNOWLEDGE_RECORD_MARK_CURRENT_FAILED',
        message: 'Failed to mark record as current',
        statusCode: 500,
      });
    }

    const [workspace] = await app.database.db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, record.workspaceId))
      .limit(1);

    await writeAuditEvent(app.database, {
      organizationId: workspace?.organizationId ?? null,
      actorType: 'user',
      actorId: principal.userId,
      action: 'knowledge_record.mark_current',
      entityType: 'knowledge_record',
      entityId: updated.id,
      metadata: { superseded },
      ipAddress: request.ip,
    });

    const tagMap = await getKnowledgeRecordTags(app.database, [updated.id]);
    const source = await loadPrimarySource(app.database, updated.id);
    const rendered = await renderMarkdown(updated.contentMarkdown);
    return {
      knowledgeRecord: toPublicRecord(updated, tagMap.get(updated.id) ?? [], source, {
        includeHtml: true,
        includeToc: true,
        html: rendered.html,
        toc: rendered.toc,
      }),
      superseded,
    };
  });

  app.delete('/api/v1/knowledge-records/:recordId', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    const params = z.object({ recordId: z.string().uuid() }).parse(request.params);

    const [record] = await app.database.db
      .select()
      .from(knowledgeRecords)
      .where(eq(knowledgeRecords.id, params.recordId))
      .limit(1);

    if (!record || record.archivedAt) {
      throw new AppError({
        code: 'KNOWLEDGE_RECORD_NOT_FOUND',
        message: 'Knowledge record not found',
        statusCode: 404,
      });
    }

    requireWorkspaceMaintainer(principal, record.workspaceId);

    const [archived] = await app.database.db
      .update(knowledgeRecords)
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(eq(knowledgeRecords.id, params.recordId))
      .returning();

    const [workspace] = await app.database.db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, record.workspaceId))
      .limit(1);

    await writeAuditEvent(app.database, {
      organizationId: workspace?.organizationId ?? null,
      actorType: 'user',
      actorId: principal.userId,
      action: 'knowledge_record.archive',
      entityType: 'knowledge_record',
      entityId: record.id,
      ipAddress: request.ip,
    });

    const tagMap = await getKnowledgeRecordTags(app.database, [record.id]);
    const source = await loadPrimarySource(app.database, record.id);
    return {
      knowledgeRecord: archived
        ? toPublicRecord(archived, tagMap.get(archived.id) ?? [], source)
        : null,
    };
  });

  /** Permanent delete — versions/tags cascade; git sync may recreate git_managed paths. */
  app.post('/api/v1/knowledge-records/:recordId/purge', async (request, reply) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    const params = z.object({ recordId: z.string().uuid() }).parse(request.params);
    z.object({ confirmDestroy: z.literal(true) }).parse(request.body ?? {});

    const [record] = await app.database.db
      .select()
      .from(knowledgeRecords)
      .where(eq(knowledgeRecords.id, params.recordId))
      .limit(1);

    if (!record) {
      throw new AppError({
        code: 'KNOWLEDGE_RECORD_NOT_FOUND',
        message: 'Knowledge record not found',
        statusCode: 404,
      });
    }

    requireWorkspaceAdmin(principal, record.workspaceId);

    const [workspace] = await app.database.db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, record.workspaceId))
      .limit(1);

    await app.database.db
      .delete(knowledgeRecords)
      .where(eq(knowledgeRecords.id, record.id));

    await writeAuditEvent(app.database, {
      organizationId: workspace?.organizationId ?? null,
      actorType: 'user',
      actorId: principal.userId,
      action: 'knowledge_record.purge',
      entityType: 'knowledge_record',
      entityId: record.id,
      metadata: {
        title: record.title,
        slug: record.slug,
        sourceOfTruthMode: record.sourceOfTruthMode,
      },
      ipAddress: request.ip,
    });

    return reply.status(204).send();
  });
}
