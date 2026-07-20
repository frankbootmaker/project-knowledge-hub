import type { users } from '@project-knowledge-hub/database';

export function avatarUrlForUser(
  userId: string,
  avatarContentType: string | null,
  updatedAt?: Date | string | null,
): string | null {
  if (!avatarContentType) return null;
  const version =
    updatedAt instanceof Date
      ? updatedAt.getTime()
      : updatedAt
        ? new Date(updatedAt).getTime()
        : Date.now();
  return `/api/v1/avatars/${userId}?v=${Number.isFinite(version) ? version : Date.now()}`;
}

export function toPublicUser(user: typeof users.$inferSelect) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    fullName: user.fullName ?? null,
    status: user.status,
    isSystemAdmin: user.isSystemAdmin,
    idpSource: user.idpSource ?? null,
    idpSubject: user.idpSubject ?? null,
    hasPassword: Boolean(user.passwordHash),
    avatarUrl: avatarUrlForUser(
      user.id,
      user.avatarContentType ?? null,
      user.updatedAt,
    ),
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

export type PublicUser = ReturnType<typeof toPublicUser>;
