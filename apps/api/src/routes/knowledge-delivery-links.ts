import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { workspaces } from '@project-knowledge-hub/database';
import { deliveryLinkEntityTypeSchema } from '@project-knowledge-hub/domain';
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
  assertProjectNotArchived,
  requireProjectContext,
} from '../lib/project-delivery.js';
import {
  getKnowledgeRecordProjectContext,
  listDeliveryDocumentLinksForProject,
  listDeliveryLinksForRecord,
  setDeliveryLinksForRecord,
} from '../lib/knowledge-delivery-links.js';

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

const replaceLinksSchema = z.object({
  links: z
    .array(
      z.object({
        entityType: deliveryLinkEntityTypeSchema,
        entityId: z.string().uuid(),
      }),
    )
    .max(200),
});

export async function registerKnowledgeDeliveryLinkRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get(
    '/api/v1/knowledge-records/:recordId/delivery-links',
    async (request) => {
      const principal = requireAuthenticated(request);
      const params = z
        .object({ recordId: z.string().uuid() })
        .parse(request.params);
      const record = await getKnowledgeRecordProjectContext(
        app.database,
        params.recordId,
      );
      requireWorkspaceView(principal, record.workspaceId);

      return {
        deliveryLinks: await listDeliveryLinksForRecord(
          app.database,
          params.recordId,
        ),
      };
    },
  );

  app.put(
    '/api/v1/knowledge-records/:recordId/delivery-links',
    async (request) => {
      assertMutatingOrigin(app, request);
      const principal = requireAuthenticated(request);
      const params = z
        .object({ recordId: z.string().uuid() })
        .parse(request.params);
      const body = replaceLinksSchema.parse(request.body);

      const record = await getKnowledgeRecordProjectContext(
        app.database,
        params.recordId,
      );
      requireWorkspaceMaintainer(principal, record.workspaceId);
      if (record.projectId) {
        const { project } = await requireProjectContext(
          app.database,
          record.projectId,
        );
        assertProjectNotArchived(project);
      }

      const deliveryLinks = await setDeliveryLinksForRecord(app.database, {
        knowledgeRecordId: params.recordId,
        links: body.links,
      });

      await writeAuditEvent(app.database, {
        organizationId: await workspaceOrgId(app, record.workspaceId),
        actorType: 'user',
        actorId: principal.userId,
        action: 'knowledge.delivery_links_set',
        entityType: 'knowledge_record',
        entityId: params.recordId,
        metadata: {
          projectId: record.projectId,
          linkCount: deliveryLinks.length,
        },
        ipAddress: request.ip,
      });

      return { deliveryLinks };
    },
  );

  app.get(
    '/api/v1/projects/:projectId/delivery-document-links',
    async (request) => {
      const principal = requireAuthenticated(request);
      const params = z
        .object({ projectId: z.string().uuid() })
        .parse(request.params);
      const query = z
        .object({
          entityType: deliveryLinkEntityTypeSchema.optional(),
          entityId: z.string().uuid().optional(),
        })
        .parse(request.query);

      const { project } = await requireProjectContext(
        app.database,
        params.projectId,
      );
      requireWorkspaceView(principal, project.workspaceId);

      return {
        documentLinks: await listDeliveryDocumentLinksForProject(
          app.database,
          project.id,
          {
            entityType: query.entityType,
            entityId: query.entityId,
          },
        ),
      };
    },
  );
}
