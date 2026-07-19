import { and, eq, ne } from 'drizzle-orm';
import {
  apiClients,
  auditEvents,
  organizations,
  tags,
  workspaces,
  type Database,
} from '@project-knowledge-hub/database';
import { AppError } from '@project-knowledge-hub/domain';

function uniqueSlug(base: string, taken: Set<string>, maxLength = 64): string {
  const normalized = base.slice(0, maxLength) || 'item';
  if (!taken.has(normalized)) {
    return normalized;
  }

  for (let index = 2; index < 10_000; index += 1) {
    const suffix = `-${index}`;
    const candidate = `${normalized.slice(0, Math.max(1, maxLength - suffix.length))}${suffix}`;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }

  throw new AppError({
    code: 'ORGANIZATION_TRANSFER_SLUG_FAILED',
    message: 'Could not allocate a unique slug during organization transfer',
    statusCode: 500,
  });
}

export type OrganizationTransferResult = {
  transferToOrganizationId: string;
  transferredWorkspaces: number;
  transferredTags: number;
  transferredApiClients: number;
  remappedAuditEvents: number;
  workspaceSlugChanges: Array<{ id: string; from: string; to: string }>;
  tagSlugChanges: Array<{ id: string; from: string; to: string }>;
};

/** Move org-owned rows to another organization, renaming slugs on conflict. */
export async function transferOrganizationAssets(
  database: Database,
  sourceOrganizationId: string,
  transferToOrganizationId: string,
): Promise<OrganizationTransferResult> {
  if (sourceOrganizationId === transferToOrganizationId) {
    throw new AppError({
      code: 'VALIDATION_ERROR',
      message: 'Transfer target must be a different organization',
      statusCode: 400,
    });
  }

  const [target] = await database.db
    .select()
    .from(organizations)
    .where(eq(organizations.id, transferToOrganizationId))
    .limit(1);
  if (!target) {
    throw new AppError({
      code: 'ORGANIZATION_NOT_FOUND',
      message: 'Transfer target organization not found',
      statusCode: 404,
    });
  }

  return database.db.transaction(async (tx) => {
    const sourceWorkspaces = await tx
      .select()
      .from(workspaces)
      .where(eq(workspaces.organizationId, sourceOrganizationId));
    const targetWorkspaceSlugs = new Set(
      (
        await tx
          .select({ slug: workspaces.slug })
          .from(workspaces)
          .where(eq(workspaces.organizationId, transferToOrganizationId))
      ).map((row) => row.slug),
    );

    const workspaceSlugChanges: OrganizationTransferResult['workspaceSlugChanges'] = [];
    for (const workspace of sourceWorkspaces) {
      const nextSlug = uniqueSlug(workspace.slug, targetWorkspaceSlugs);
      targetWorkspaceSlugs.add(nextSlug);
      if (nextSlug !== workspace.slug) {
        workspaceSlugChanges.push({
          id: workspace.id,
          from: workspace.slug,
          to: nextSlug,
        });
      }
      await tx
        .update(workspaces)
        .set({
          organizationId: transferToOrganizationId,
          slug: nextSlug,
          updatedAt: new Date(),
        })
        .where(eq(workspaces.id, workspace.id));
    }

    const sourceTags = await tx
      .select()
      .from(tags)
      .where(eq(tags.organizationId, sourceOrganizationId));
    const targetTagSlugs = new Set(
      (
        await tx
          .select({ slug: tags.slug })
          .from(tags)
          .where(eq(tags.organizationId, transferToOrganizationId))
      ).map((row) => row.slug),
    );

    const tagSlugChanges: OrganizationTransferResult['tagSlugChanges'] = [];
    for (const tag of sourceTags) {
      const nextSlug = uniqueSlug(tag.slug, targetTagSlugs);
      targetTagSlugs.add(nextSlug);
      if (nextSlug !== tag.slug) {
        tagSlugChanges.push({ id: tag.id, from: tag.slug, to: nextSlug });
      }
      await tx
        .update(tags)
        .set({
          organizationId: transferToOrganizationId,
          slug: nextSlug,
        })
        .where(eq(tags.id, tag.id));
    }

    const transferredApiClients = await tx
      .update(apiClients)
      .set({ organizationId: transferToOrganizationId })
      .where(eq(apiClients.organizationId, sourceOrganizationId))
      .returning({ id: apiClients.id });

    const remappedAudit = await tx
      .update(auditEvents)
      .set({ organizationId: transferToOrganizationId })
      .where(eq(auditEvents.organizationId, sourceOrganizationId))
      .returning({ id: auditEvents.id });

    return {
      transferToOrganizationId,
      transferredWorkspaces: sourceWorkspaces.length,
      transferredTags: sourceTags.length,
      transferredApiClients: transferredApiClients.length,
      remappedAuditEvents: remappedAudit.length,
      workspaceSlugChanges,
      tagSlugChanges,
    };
  });
}

export async function listOtherOrganizations(
  database: Database,
  organizationId: string,
) {
  return database.db
    .select()
    .from(organizations)
    .where(ne(organizations.id, organizationId));
}

export async function assertTransferTarget(
  database: Database,
  sourceOrganizationId: string,
  transferToOrganizationId: string,
): Promise<void> {
  const [target] = await database.db
    .select()
    .from(organizations)
    .where(
      and(
        eq(organizations.id, transferToOrganizationId),
        ne(organizations.id, sourceOrganizationId),
      ),
    )
    .limit(1);

  if (!target) {
    throw new AppError({
      code: 'ORGANIZATION_TRANSFER_TARGET_INVALID',
      message: 'Transfer target organization is invalid',
      statusCode: 400,
    });
  }
}
