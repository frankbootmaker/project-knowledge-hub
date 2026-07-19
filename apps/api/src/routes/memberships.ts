import type { FastifyInstance } from 'fastify';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { memberships, users, workspaces } from '@project-knowledge-hub/database';
import { AppError, membershipRoleSchema } from '@project-knowledge-hub/domain';
import { requireSystemAdmin } from '@project-knowledge-hub/permissions';
import {
  assertMutatingOrigin,
  requireAuthenticated,
} from '../plugins/auth.js';
import { writeAuditEvent } from '../lib/identity.js';

const assignableRoleSchema = z.enum(['workspace_admin', 'maintainer', 'reader']);

const createMembershipSchema = z.object({
  userId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  role: assignableRoleSchema,
});

const updateMembershipSchema = z.object({
  role: assignableRoleSchema,
});

export async function registerMembershipRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/memberships', async (request) => {
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);
    const query = z
      .object({
        workspaceId: z.string().uuid().optional(),
        userId: z.string().uuid().optional(),
      })
      .parse(request.query);

    const conditions = [];
    if (query.workspaceId) {
      conditions.push(eq(memberships.workspaceId, query.workspaceId));
    }
    if (query.userId) {
      conditions.push(eq(memberships.userId, query.userId));
    }

    const rows = await app.database.db
      .select({
        id: memberships.id,
        userId: memberships.userId,
        workspaceId: memberships.workspaceId,
        role: memberships.role,
        createdAt: memberships.createdAt,
        userEmail: users.email,
        userDisplayName: users.displayName,
        workspaceName: workspaces.name,
        workspaceSlug: workspaces.slug,
        organizationId: workspaces.organizationId,
      })
      .from(memberships)
      .innerJoin(users, eq(memberships.userId, users.id))
      .innerJoin(workspaces, eq(memberships.workspaceId, workspaces.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(memberships.createdAt));

    return {
      memberships: rows.map((row) => ({
        id: row.id,
        userId: row.userId,
        workspaceId: row.workspaceId,
        role: membershipRoleSchema.parse(row.role),
        createdAt: row.createdAt.toISOString(),
        user: {
          id: row.userId,
          email: row.userEmail,
          displayName: row.userDisplayName,
        },
        workspace: {
          id: row.workspaceId,
          name: row.workspaceName,
          slug: row.workspaceSlug,
          organizationId: row.organizationId,
        },
      })),
    };
  });

  app.post('/api/v1/memberships', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);
    const body = createMembershipSchema.parse(request.body);

    const [user] = await app.database.db
      .select()
      .from(users)
      .where(eq(users.id, body.userId))
      .limit(1);
    if (!user) {
      throw new AppError({
        code: 'USER_NOT_FOUND',
        message: 'User not found',
        statusCode: 404,
      });
    }

    const [workspace] = await app.database.db
      .select()
      .from(workspaces)
      .where(and(eq(workspaces.id, body.workspaceId), isNull(workspaces.archivedAt)))
      .limit(1);
    if (!workspace) {
      throw new AppError({
        code: 'WORKSPACE_NOT_FOUND',
        message: 'Workspace not found',
        statusCode: 404,
      });
    }

    const [existing] = await app.database.db
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, body.userId),
          eq(memberships.workspaceId, body.workspaceId),
        ),
      )
      .limit(1);
    if (existing) {
      throw new AppError({
        code: 'MEMBERSHIP_CONFLICT',
        message: 'User is already a member of this workspace',
        statusCode: 409,
      });
    }

    const [created] = await app.database.db
      .insert(memberships)
      .values({
        userId: body.userId,
        workspaceId: body.workspaceId,
        role: body.role,
      })
      .returning();

    if (!created) {
      throw new AppError({
        code: 'MEMBERSHIP_CREATE_FAILED',
        message: 'Failed to create membership',
        statusCode: 500,
      });
    }

    await writeAuditEvent(app.database, {
      organizationId: workspace.organizationId,
      actorType: 'user',
      actorId: principal.userId,
      action: 'membership.create',
      entityType: 'membership',
      entityId: created.id,
      metadata: {
        userId: body.userId,
        workspaceId: body.workspaceId,
        role: body.role,
      },
      ipAddress: request.ip,
    });

    return {
      membership: {
        id: created.id,
        userId: created.userId,
        workspaceId: created.workspaceId,
        role: created.role,
        createdAt: created.createdAt.toISOString(),
      },
    };
  });

  app.patch('/api/v1/memberships/:membershipId', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);
    const params = z.object({ membershipId: z.string().uuid() }).parse(request.params);
    const body = updateMembershipSchema.parse(request.body);

    const [existing] = await app.database.db
      .select({
        membership: memberships,
        organizationId: workspaces.organizationId,
      })
      .from(memberships)
      .innerJoin(workspaces, eq(memberships.workspaceId, workspaces.id))
      .where(eq(memberships.id, params.membershipId))
      .limit(1);

    if (!existing) {
      throw new AppError({
        code: 'MEMBERSHIP_NOT_FOUND',
        message: 'Membership not found',
        statusCode: 404,
      });
    }

    const [updated] = await app.database.db
      .update(memberships)
      .set({ role: body.role })
      .where(eq(memberships.id, params.membershipId))
      .returning();

    await writeAuditEvent(app.database, {
      organizationId: existing.organizationId,
      actorType: 'user',
      actorId: principal.userId,
      action: 'membership.update',
      entityType: 'membership',
      entityId: params.membershipId,
      metadata: { role: body.role },
      ipAddress: request.ip,
    });

    return {
      membership: updated
        ? {
            id: updated.id,
            userId: updated.userId,
            workspaceId: updated.workspaceId,
            role: updated.role,
            createdAt: updated.createdAt.toISOString(),
          }
        : null,
    };
  });

  app.delete('/api/v1/memberships/:membershipId', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);
    const params = z.object({ membershipId: z.string().uuid() }).parse(request.params);

    const [existing] = await app.database.db
      .select({
        membership: memberships,
        organizationId: workspaces.organizationId,
      })
      .from(memberships)
      .innerJoin(workspaces, eq(memberships.workspaceId, workspaces.id))
      .where(eq(memberships.id, params.membershipId))
      .limit(1);

    if (!existing) {
      throw new AppError({
        code: 'MEMBERSHIP_NOT_FOUND',
        message: 'Membership not found',
        statusCode: 404,
      });
    }

    await app.database.db
      .delete(memberships)
      .where(eq(memberships.id, params.membershipId));

    await writeAuditEvent(app.database, {
      organizationId: existing.organizationId,
      actorType: 'user',
      actorId: principal.userId,
      action: 'membership.delete',
      entityType: 'membership',
      entityId: params.membershipId,
      metadata: {
        userId: existing.membership.userId,
        workspaceId: existing.membership.workspaceId,
      },
      ipAddress: request.ip,
    });

    return { ok: true };
  });
}
