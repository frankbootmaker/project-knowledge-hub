import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { workspaces } from '@project-knowledge-hub/database';
import {
  DELIVERY_DEPENDENCY_ENTITY_TYPES,
  DELIVERY_DEPENDENCY_LINK_TYPES,
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
  listDeliveryDependencies,
  removeDeliveryDependency,
  setDeliveryDependency,
} from '../lib/delivery-dependencies.js';
import {
  assertProjectNotArchived,
  requireProjectContext,
} from '../lib/project-delivery.js';

const entityTypeSchema = z.enum(DELIVERY_DEPENDENCY_ENTITY_TYPES);
const linkTypeSchema = z.enum(DELIVERY_DEPENDENCY_LINK_TYPES);
const refSchema = z.string().trim().min(1).max(80);

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

export async function registerDeliveryDependencyRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get(
    '/api/v1/projects/:projectId/delivery-dependencies',
    async (request) => {
      const principal = requireAuthenticated(request);
      const params = z
        .object({ projectId: z.string().uuid() })
        .parse(request.params);
      const query = z
        .object({
          entityId: refSchema,
          entityType: entityTypeSchema.optional(),
        })
        .parse(request.query);
      const { project } = await requireProjectContext(
        app.database,
        params.projectId,
      );
      requireWorkspaceView(principal, project.workspaceId);
      return listDeliveryDependencies({
        database: app.database,
        projectId: project.id,
        idOrKey: query.entityId,
        entityType: query.entityType,
      });
    },
  );

  app.post(
    '/api/v1/projects/:projectId/delivery-dependencies',
    async (request) => {
      assertMutatingOrigin(app, request);
      const principal = requireAuthenticated(request);
      const params = z
        .object({ projectId: z.string().uuid() })
        .parse(request.params);
      const body = z
        .object({
          predecessorId: refSchema,
          predecessorType: entityTypeSchema.optional(),
          successorId: refSchema,
          successorType: entityTypeSchema.optional(),
          linkType: linkTypeSchema,
          lagDays: z.number().int().min(-3650).max(3650).optional(),
        })
        .parse(request.body);
      const { project } = await requireProjectContext(
        app.database,
        params.projectId,
      );
      requireWorkspaceMaintainer(principal, project.workspaceId);
      assertProjectNotArchived(project);
      const result = await setDeliveryDependency(app.database, {
        projectId: project.id,
        ...body,
        createdBy: principal.userId,
      });
      await writeAuditEvent(app.database, {
        organizationId: await workspaceOrgId(app, project.workspaceId),
        actorType: 'user',
        actorId: principal.userId,
        action: 'project.delivery_dependency_set',
        entityType: 'project_delivery_dependency',
        entityId: result.dependency.id,
        metadata: {
          projectId: project.id,
          linkType: result.dependency.linkType,
          lagDays: result.dependency.lagDays,
          predecessorId: result.dependency.predecessor.id,
          successorId: result.dependency.successor.id,
        },
        ipAddress: request.ip,
      });
      return result;
    },
  );

  app.delete(
    '/api/v1/projects/:projectId/delivery-dependencies/:linkId',
    async (request) => {
      assertMutatingOrigin(app, request);
      const principal = requireAuthenticated(request);
      const params = z
        .object({
          projectId: z.string().uuid(),
          linkId: z.string().uuid(),
        })
        .parse(request.params);
      const { project } = await requireProjectContext(
        app.database,
        params.projectId,
      );
      requireWorkspaceMaintainer(principal, project.workspaceId);
      assertProjectNotArchived(project);
      const result = await removeDeliveryDependency(app.database, {
        projectId: project.id,
        linkId: params.linkId,
      });
      await writeAuditEvent(app.database, {
        organizationId: await workspaceOrgId(app, project.workspaceId),
        actorType: 'user',
        actorId: principal.userId,
        action: 'project.delivery_dependency_removed',
        entityType: 'project_delivery_dependency',
        entityId: result.removedId,
        metadata: { projectId: project.id },
        ipAddress: request.ip,
      });
      return result;
    },
  );
}
