import { and, eq, isNull } from 'drizzle-orm';
import type { Database } from '@project-knowledge-hub/database';
import { users } from '@project-knowledge-hub/database';

export type OidcResolveInput = {
  idpSource: string;
  subject: string;
  email: string | null;
  emailVerified: boolean;
};

export type OidcResolveResult =
  | { status: 'ok'; user: typeof users.$inferSelect; linked: boolean }
  | { status: 'unknown' }
  | { status: 'inactive'; userId: string }
  | { status: 'conflict' };

/**
 * Invite/link-only resolution:
 * 1) match (idp_source, idp_subject)
 * 2) else link active user by verified email when IdP fields are empty
 */
export async function resolveOidcUser(
  database: Database,
  input: OidcResolveInput,
): Promise<OidcResolveResult> {
  const [bySubject] = await database.db
    .select()
    .from(users)
    .where(
      and(eq(users.idpSource, input.idpSource), eq(users.idpSubject, input.subject)),
    )
    .limit(1);

  if (bySubject) {
    if (bySubject.status !== 'active') {
      return { status: 'inactive', userId: bySubject.id };
    }
    return { status: 'ok', user: bySubject, linked: false };
  }

  if (!input.email || !input.emailVerified) {
    return { status: 'unknown' };
  }

  const [byEmail] = await database.db
    .select()
    .from(users)
    .where(eq(users.email, input.email.toLowerCase()))
    .limit(1);

  if (!byEmail) {
    return { status: 'unknown' };
  }

  if (byEmail.status !== 'active') {
    return { status: 'inactive', userId: byEmail.id };
  }

  if (byEmail.idpSource || byEmail.idpSubject) {
    // Already linked to a different IdP identity
    return { status: 'conflict' };
  }

  const [linked] = await database.db
    .update(users)
    .set({
      idpSource: input.idpSource,
      idpSubject: input.subject,
      updatedAt: new Date(),
    })
    .where(and(eq(users.id, byEmail.id), isNull(users.idpSource), isNull(users.idpSubject)))
    .returning();

  if (!linked) {
    return { status: 'conflict' };
  }

  return { status: 'ok', user: linked, linked: true };
}
