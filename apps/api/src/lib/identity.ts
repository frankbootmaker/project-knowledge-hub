import { and, eq, gt, isNull } from 'drizzle-orm';
import {
  auditEvents,
  memberships,
  organizations,
  sessions,
  users,
  workspaces,
  type Database,
} from '@project-knowledge-hub/database';
import { membershipRoleSchema, type MembershipRole } from '@project-knowledge-hub/domain';
import type { AuthPrincipal } from '@project-knowledge-hub/permissions';

export async function writeAuditEvent(
  database: Database,
  input: {
    organizationId?: string | null;
    actorType: string;
    actorId?: string | null;
    action: string;
    entityType: string;
    entityId?: string | null;
    metadata?: Record<string, unknown>;
    ipAddress?: string | null;
  },
): Promise<void> {
  await database.db.insert(auditEvents).values({
    organizationId: input.organizationId ?? null,
    actorType: input.actorType,
    actorId: input.actorId ?? null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    metadataJson: input.metadata ?? null,
    ipAddress: input.ipAddress ?? null,
  });
}

export async function loadPrincipalBySessionToken(
  database: Database,
  tokenHash: string,
): Promise<AuthPrincipal | null> {
  const now = new Date();
  const [session] = await database.db
    .select({
      sessionId: sessions.id,
      userId: sessions.userId,
      expiresAt: sessions.expiresAt,
      revokedAt: sessions.revokedAt,
      email: users.email,
      displayName: users.displayName,
      status: users.status,
      isSystemAdmin: users.isSystemAdmin,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(
      and(
        eq(sessions.tokenHash, tokenHash),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, now),
      ),
    )
    .limit(1);

  if (!session || session.status !== 'active') {
    return null;
  }

  const userMemberships = await database.db
    .select({
      workspaceId: memberships.workspaceId,
      role: memberships.role,
    })
    .from(memberships)
    .where(eq(memberships.userId, session.userId));

  return {
    userId: session.userId,
    email: session.email,
    displayName: session.displayName,
    isSystemAdmin: session.isSystemAdmin,
    memberships: userMemberships.map((membership) => ({
      workspaceId: membership.workspaceId,
      role: membershipRoleSchema.parse(membership.role),
    })),
  };
}

export async function getDefaultOrganization(database: Database) {
  const [organization] = await database.db.select().from(organizations).limit(1);
  return organization ?? null;
}

export type WorkspaceRecord = typeof workspaces.$inferSelect;

export function toPublicWorkspace(workspace: WorkspaceRecord) {
  return {
    id: workspace.id,
    organizationId: workspace.organizationId,
    name: workspace.name,
    slug: workspace.slug,
    description: workspace.description,
    color: workspace.color ?? null,
    archivedAt: workspace.archivedAt?.toISOString() ?? null,
    createdAt: workspace.createdAt.toISOString(),
    updatedAt: workspace.updatedAt.toISOString(),
  };
}

export function parseMembershipRole(role: string): MembershipRole {
  return membershipRoleSchema.parse(role);
}
