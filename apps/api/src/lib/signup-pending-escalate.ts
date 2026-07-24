import { and, eq, isNull, lt } from 'drizzle-orm';
import { users, type Database } from '@project-knowledge-hub/database';
import type { MailTransport } from '@project-knowledge-hub/mail';
import { sendSignupPendingEscalationMail } from './auth-mail.js';
import { listActiveSystemAdmins } from './signup-pending-notify.js';

function formatPendingAge(ms: number): string {
  const hours = Math.max(1, Math.floor(ms / (60 * 60 * 1000)));
  if (hours < 48) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

/**
 * One-shot escalation: pending_approval users older than threshold hours,
 * not yet escalated → mail all active system admins.
 */
export async function escalateStaleSignupApprovals(input: {
  database: Database;
  mail: MailTransport;
  webUrl: string;
  escalateAfterHours: number;
}): Promise<{ escalated: number }> {
  const cutoff = new Date(
    Date.now() - input.escalateAfterHours * 60 * 60 * 1000,
  );

  const pending = await input.database.db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      updatedAt: users.updatedAt,
    })
    .from(users)
    .where(
      and(
        eq(users.status, 'pending_approval'),
        isNull(users.signupPendingEscalatedAt),
        lt(users.updatedAt, cutoff),
      ),
    )
    .limit(50);

  if (pending.length === 0) {
    return { escalated: 0 };
  }

  const admins = await listActiveSystemAdmins(input.database);
  if (admins.length === 0) {
    return { escalated: 0 };
  }

  let escalated = 0;
  for (const signup of pending) {
    const ageMs = Date.now() - signup.updatedAt.getTime();
    await Promise.all(
      admins.map((admin) =>
        sendSignupPendingEscalationMail(input.mail, {
          webUrl: input.webUrl,
          to: admin.email,
          displayName: admin.displayName,
          signupDisplayName: signup.displayName,
          signupEmail: signup.email,
          pendingSince: signup.updatedAt.toISOString(),
          pendingAge: formatPendingAge(ageMs),
          locale: admin.preferredLocale,
        }).catch(() => undefined),
      ),
    );

    await input.database.db
      .update(users)
      .set({ signupPendingEscalatedAt: new Date() })
      .where(eq(users.id, signup.id));
    escalated += 1;
  }

  return { escalated };
}
