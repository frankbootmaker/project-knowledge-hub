import type { FastifyInstance } from 'fastify';
import { count, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { slugify } from '@project-knowledge-hub/auth';
import {
  apiClients,
  organizations,
  tags,
  workspaces,
} from '@project-knowledge-hub/database';
import { AppError } from '@project-knowledge-hub/domain';
import { requireSystemAdmin } from '@project-knowledge-hub/permissions';
import {
  assertMutatingOrigin,
  requireAuthenticated,
} from '../plugins/auth.js';
import { writeAuditEvent } from '../lib/identity.js';
import {
  assertTransferTarget,
  listOtherOrganizations,
  transferOrganizationAssets,
} from '../lib/organization-transfer.js';

function toPublicOrganization(
  org: typeof organizations.$inferSelect,
  workspaceCount = 0,
) {
  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    workspaceCount,
    createdAt: org.createdAt.toISOString(),
    updatedAt: org.updatedAt.toISOString(),
  };
}

const createOrganizationSchema = z.object({
  name: z.string().min(1).max(160),
  slug: z.string().min(1).max(64).optional(),
});

const updateOrganizationSchema = z
  .object({
    name: z.string().min(1).max(160).optional(),
    slug: z.string().min(1).max(64).optional(),
  })
  .refine((body) => body.name !== undefined || body.slug !== undefined, {
    message: 'At least one of name or slug is required',
  });

const deleteOrganizationSchema = z
  .object({
    mode: z.enum(['transfer', 'destroy']).default('transfer'),
    transferToOrganizationId: z.string().uuid().optional(),
    /** Required when mode is `destroy` — prevents accidental cascade wipes. */
    confirmDestroy: z.literal(true).optional(),
  })
  .superRefine((body, ctx) => {
    if (body.mode === 'destroy' && body.confirmDestroy !== true) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'confirmDestroy must be true when permanently deleting inherited items',
        path: ['confirmDestroy'],
      });
    }
  });

async function assertSlugAvailable(
  app: FastifyInstance,
  slug: string,
  exceptId?: string,
): Promise<void> {
  const [existing] = await app.database.db
    .select()
    .from(organizations)
    .where(eq(organizations.slug, slug))
    .limit(1);

  if (existing && existing.id !== exceptId) {
    throw new AppError({
      code: 'ORGANIZATION_SLUG_CONFLICT',
      message: 'An organization with this slug already exists',
      statusCode: 409,
    });
  }
}

async function countOrgAssets(app: FastifyInstance, organizationId: string) {
  const [workspaceCountRow] = await app.database.db
    .select({ total: count() })
    .from(workspaces)
    .where(eq(workspaces.organizationId, organizationId));
  const [tagCountRow] = await app.database.db
    .select({ total: count() })
    .from(tags)
    .where(eq(tags.organizationId, organizationId));
  const [clientCountRow] = await app.database.db
    .select({ total: count() })
    .from(apiClients)
    .where(eq(apiClients.organizationId, organizationId));

  return {
    workspaceCount: Number(workspaceCountRow?.total ?? 0),
    tagCount: Number(tagCountRow?.total ?? 0),
    apiClientCount: Number(clientCountRow?.total ?? 0),
  };
}

export async function registerOrganizationRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/organizations', async (request) => {
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);

    const rows = await app.database.db
      .select({
        organization: organizations,
        workspaceCount: count(workspaces.id),
      })
      .from(organizations)
      .leftJoin(workspaces, eq(workspaces.organizationId, organizations.id))
      .groupBy(organizations.id)
      .orderBy(desc(organizations.createdAt));

    return {
      organizations: rows.map((row) =>
        toPublicOrganization(row.organization, Number(row.workspaceCount)),
      ),
    };
  });

  app.post('/api/v1/organizations', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);
    const body = createOrganizationSchema.parse(request.body);

    const slug = body.slug ? slugify(body.slug) : slugify(body.name);
    if (!slug) {
      throw new AppError({
        code: 'VALIDATION_ERROR',
        message: 'Organization slug is invalid',
        statusCode: 400,
      });
    }

    await assertSlugAvailable(app, slug);

    const [created] = await app.database.db
      .insert(organizations)
      .values({
        name: body.name.trim(),
        slug,
      })
      .returning();

    if (!created) {
      throw new AppError({
        code: 'ORGANIZATION_CREATE_FAILED',
        message: 'Failed to create organization',
        statusCode: 500,
      });
    }

    await writeAuditEvent(app.database, {
      organizationId: created.id,
      actorType: 'user',
      actorId: principal.userId,
      action: 'organization.create',
      entityType: 'organization',
      entityId: created.id,
      metadata: { name: created.name, slug: created.slug },
      ipAddress: request.ip,
    });

    return { organization: toPublicOrganization(created) };
  });

  app.patch('/api/v1/organizations/:organizationId', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);
    const params = z
      .object({ organizationId: z.string().uuid() })
      .parse(request.params);
    const body = updateOrganizationSchema.parse(request.body);

    const [existing] = await app.database.db
      .select()
      .from(organizations)
      .where(eq(organizations.id, params.organizationId))
      .limit(1);

    if (!existing) {
      throw new AppError({
        code: 'ORGANIZATION_NOT_FOUND',
        message: 'Organization not found',
        statusCode: 404,
      });
    }

    const nextName = body.name?.trim();
    const nextSlug = body.slug !== undefined ? slugify(body.slug) : undefined;
    if (body.slug !== undefined && !nextSlug) {
      throw new AppError({
        code: 'VALIDATION_ERROR',
        message: 'Organization slug is invalid',
        statusCode: 400,
      });
    }

    if (nextSlug && nextSlug !== existing.slug) {
      await assertSlugAvailable(app, nextSlug, existing.id);
    }

    const [updated] = await app.database.db
      .update(organizations)
      .set({
        ...(nextName !== undefined ? { name: nextName } : {}),
        ...(nextSlug !== undefined ? { slug: nextSlug } : {}),
        updatedAt: new Date(),
      })
      .where(eq(organizations.id, params.organizationId))
      .returning();

    if (!updated) {
      throw new AppError({
        code: 'ORGANIZATION_UPDATE_FAILED',
        message: 'Failed to update organization',
        statusCode: 500,
      });
    }

    await writeAuditEvent(app.database, {
      organizationId: updated.id,
      actorType: 'user',
      actorId: principal.userId,
      action: 'organization.update',
      entityType: 'organization',
      entityId: updated.id,
      metadata: {
        name: updated.name,
        slug: updated.slug,
        previousName: existing.name,
        previousSlug: existing.slug,
      },
      ipAddress: request.ip,
    });

    return { organization: toPublicOrganization(updated) };
  });

  app.delete('/api/v1/organizations/:organizationId', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);
    const params = z
      .object({ organizationId: z.string().uuid() })
      .parse(request.params);
    const body = deleteOrganizationSchema.parse(request.body ?? {});

    const [existing] = await app.database.db
      .select()
      .from(organizations)
      .where(eq(organizations.id, params.organizationId))
      .limit(1);

    if (!existing) {
      throw new AppError({
        code: 'ORGANIZATION_NOT_FOUND',
        message: 'Organization not found',
        statusCode: 404,
      });
    }

    const others = await listOtherOrganizations(app.database, existing.id);
    if (others.length === 0) {
      throw new AppError({
        code: 'ORGANIZATION_LAST_REMAINING',
        message: 'Cannot delete the last remaining organization',
        statusCode: 409,
      });
    }

    const assets = await countOrgAssets(app, existing.id);
    const hasAssets =
      assets.workspaceCount + assets.tagCount + assets.apiClientCount > 0;

    let transfer: Awaited<ReturnType<typeof transferOrganizationAssets>> | null =
      null;
    let transferToOrganizationId: string | undefined;
    const mode = body.mode;

    if (mode === 'destroy') {
      if (body.confirmDestroy !== true) {
        throw new AppError({
          code: 'ORGANIZATION_DESTROY_CONFIRMATION_REQUIRED',
          message:
            'Permanent deletion of inherited items requires confirmDestroy: true',
          statusCode: 400,
        });
      }
    } else {
      transferToOrganizationId = body.transferToOrganizationId;
      if (!transferToOrganizationId && others.length === 1) {
        transferToOrganizationId = others[0]!.id;
      }

      if (hasAssets && !transferToOrganizationId) {
        throw new AppError({
          code: 'ORGANIZATION_TRANSFER_REQUIRED',
          message:
            'Select an organization to receive workspaces, tags, and API clients before deleting',
          statusCode: 400,
        });
      }

      if (transferToOrganizationId) {
        await assertTransferTarget(
          app.database,
          existing.id,
          transferToOrganizationId,
        );
        if (hasAssets) {
          transfer = await transferOrganizationAssets(
            app.database,
            existing.id,
            transferToOrganizationId,
          );
        }
      }
    }

    await writeAuditEvent(app.database, {
      // Prefer a surviving org so the event stays attributed after cascade delete.
      organizationId:
        mode === 'destroy'
          ? (others[0]?.id ?? existing.id)
          : (transferToOrganizationId ?? existing.id),
      actorType: 'user',
      actorId: principal.userId,
      action: 'organization.delete',
      entityType: 'organization',
      entityId: existing.id,
      metadata: {
        name: existing.name,
        slug: existing.slug,
        ...assets,
        mode,
        destroyInherited: mode === 'destroy',
        transferToOrganizationId: transferToOrganizationId ?? null,
        transfer,
      },
      ipAddress: request.ip,
    });

    const [deleted] = await app.database.db
      .delete(organizations)
      .where(eq(organizations.id, params.organizationId))
      .returning();

    if (!deleted) {
      throw new AppError({
        code: 'ORGANIZATION_DELETE_FAILED',
        message: 'Failed to delete organization',
        statusCode: 500,
      });
    }

    return {
      organization: toPublicOrganization(deleted, assets.workspaceCount),
      mode,
      transfer,
      destroyedInherited: mode === 'destroy' ? assets : null,
    };
  });
}
