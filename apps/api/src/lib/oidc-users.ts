import { and, eq, isNull } from 'drizzle-orm';
import type { Database } from '@project-knowledge-hub/database';
import { users } from '@project-knowledge-hub/database';

export type OidcResolveInput = {
  idpSource: string;
  subject: string;
  email: string | null;
  emailVerified: boolean;
  displayName?: string | null;
  jitProvisioning?: boolean;
};

export type OidcResolveResult =
  | { status: 'ok'; user: typeof users.$inferSelect; linked: boolean; created: boolean }
  | { status: 'unknown' }
  | { status: 'inactive'; userId: string }
  | { status: 'conflict' };

function displayNameFromClaims(input: OidcResolveInput): string {
  const fromClaim = input.displayName?.trim();
  if (fromClaim) {
    return fromClaim.slice(0, 120);
  }
  const local = input.email?.split('@')[0]?.trim();
  if (local) {
    return local.slice(0, 120);
  }
  return 'SSO user';
}

/**
 * Invite/link resolution, with optional JIT create:
 * 1) match (idp_source, idp_subject)
 * 2) else link active user by verified email when IdP fields are empty
 * 3) else when jitProvisioning + verified email → insert active user
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
    return { status: 'ok', user: bySubject, linked: false, created: false };
  }

  if (!input.email || !input.emailVerified) {
    return { status: 'unknown' };
  }

  const email = input.email.toLowerCase();
  const [byEmail] = await database.db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (!byEmail) {
    if (!input.jitProvisioning) {
      return { status: 'unknown' };
    }

    try {
      const [created] = await database.db
        .insert(users)
        .values({
          email,
          displayName: displayNameFromClaims(input),
          passwordHash: null,
          status: 'active',
          idpSource: input.idpSource,
          idpSubject: input.subject,
        })
        .returning();
      if (!created) {
        return { status: 'unknown' };
      }
      return { status: 'ok', user: created, linked: false, created: true };
    } catch {
      // Unique race: another request created the email row — fall through to link path.
      const [raced] = await database.db
        .select()
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
      if (!raced) {
        return { status: 'unknown' };
      }
      return linkExistingByEmail(database, raced, input);
    }
  }

  return linkExistingByEmail(database, byEmail, input);
}

async function linkExistingByEmail(
  database: Database,
  byEmail: typeof users.$inferSelect,
  input: OidcResolveInput,
): Promise<OidcResolveResult> {
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

  return { status: 'ok', user: linked, linked: true, created: false };
}
