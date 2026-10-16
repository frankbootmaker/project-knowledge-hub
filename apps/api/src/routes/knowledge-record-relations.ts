import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { workspaces } from '@project-knowledge-hub/database';
import {
  MAX_KNOWLEDGE_RECORD_RELATIONS,
  knowledgeRecordRelationTypeSchema,
} from '@project-knowledge-hub/domain';
import {
  requireWorkspaceMaintainer,
  requireWorkspaceView,
} from '@project-knowledge-hub/permissions';
import {
  assertMutatingOrigin,
  requireAuthenticated,
} from '../plugins/auth.js';
import { writeAuditEvent } from '../lib/identity.js';
import {
  getKnowledgeRecordRelations,
  relationAuditMetadata,
  setKnowledgeRecordRelations,
} from '../lib/knowledge-record-relations.js';
import {
  assertProjectNotArchived,
  requireProjectContext,
} from '../lib/project-delivery.js';
import { resolveKnowledgeRecordId } from '../lib/project-issue-keys.js';
import { getKnowledgeRecordProjectContext } from '../lib/knowledge-delivery-links.js';

async function workspaceOrgId(
  app: FastifyInstance,
  workspaceId: string,
): Promise<string | null> {
  const [workspace] = await app.database.db
    .select({ organizationId: workspaces.organizationId })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  return workspace?.organizationId ?? null;
}

const replaceRelationsSchema = z.object({
  links: z
    .array(
      z.object({
        targetRecordId: z.string().min(1).max(80),
        relationType: knowledgeRecordRelationTypeSchema,
      }),
    )
    .max(MAX_KNOWLEDGE_RECORD_RELATIONS),
});

async function resolveRecordRef(
  app: FastifyInstance,
  idOrKey: string,
  principal: ReturnType<typeof requireAuthenticated>,
): Promise<string> {
  const workspaceIds = principal.isSystemAdmin
    ? undefined
    : principal.memberships.map((membership) => membership.workspaceId);
  return resolveKnowledgeRecordId(app.database, {
    idOrKey,
    workspaceIds,
    includeArchived: true,
  });
}

export async function registerKnowledgeRecordRelationRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get(
    '/api/v1/knowledge-records/:recordId/relations',
    async (request) => {
      const principal = requireAuthenticated(request);
      const params = z
        .object({ recordId: z.string().min(1).max(80) })
        .parse(request.params);
      const recordId = await resolveRecordRef(app, params.recordId, principal);
      const record = await getKnowledgeRecordProjectContext(
        app.database,
        recordId,
      );
      requireWorkspaceView(principal, record.workspaceId);
      return getKnowledgeRecordRelations(app.database, recordId);
    },
  );

  app.put(
    '/api/v1/knowledge-records/:recordId/relations',
    async (request) => {
      assertMutatingOrigin(app, request);
      const principal = requireAuthenticated(request);
      const params = z
        .object({ recordId: z.string().min(1).max(80) })
        .parse(request.params);
      const body = replaceRelationsSchema.parse(request.body);
      const recordId = await resolveRecordRef(app, params.recordId, principal);
      const record = await getKnowledgeRecordProjectContext(
        app.database,
        recordId,
      );
      requireWorkspaceMaintainer(principal, record.workspaceId);
      if (record.projectId) {
        const { project } = await requireProjectContext(
          app.database,
          record.projectId,
        );
        assertProjectNotArchived(project);
      }

      const workspaceIds = principal.isSystemAdmin
        ? undefined
        : principal.memberships.map((membership) => membership.workspaceId);
      const links = await Promise.all(
        body.links.map(async (link) => ({
          targetRecordId: await resolveKnowledgeRecordId(app.database, {
            idOrKey: link.targetRecordId,
            workspaceIds,
            includeArchived: true,
          }),
          relationType: link.relationType,
        })),
      );

      const relations = await setKnowledgeRecordRelations(app.database, {
        anchorId: recordId,
        links,
        createdBy: principal.userId,
      });

      await writeAuditEvent(app.database, {
        organizationId: await workspaceOrgId(app, record.workspaceId),
        actorType: 'user',
        actorId: principal.userId,
        action: 'knowledge.record_relations_set',
        entityType: 'knowledge_record',
        entityId: recordId,
        metadata: relationAuditMetadata({
          projectId: record.projectId,
          links,
        }),
        ipAddress: request.ip,
      });

      return relations;
    },
  );
}
