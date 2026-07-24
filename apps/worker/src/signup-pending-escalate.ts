import { and, eq, isNull, lt } from 'drizzle-orm';
import { users, type Database } from '@project-knowledge-hub/database';
import {
  createMailTransport,
  signupPendingEscalationEmail,
  adminUsersPendingUrl,
  type MailConfig,
} from '@project-knowledge-hub/mail';

function formatPendingAge(ms: number): string {
  const hours = Math.max(1, Math.floor(ms / (60 * 60 * 1000)));
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export async function escalateStaleSignupApprovals(input: {
  database: Database;
  mailConfig: MailConfig;
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

  const admins = await input.database.db
    .select({
      displayName: users.displayName,
      email: users.email,
      preferredLocale: users.preferredLocale,
    })
    .from(users)
    .where(and(eq(users.isSystemAdmin, true), eq(users.status, 'active')));

  if (admins.length === 0) {
    return { escalated: 0 };
  }

  const mail = createMailTransport(input.mailConfig);
  const reviewUrl = adminUsersPendingUrl(input.webUrl);
  let escalated = 0;

  for (const signup of pending) {
    const ageMs = Date.now() - signup.updatedAt.getTime();
    const pendingAge = formatPendingAge(ageMs);
    const pendingSince = signup.updatedAt.toISOString();

    await Promise.all(
      admins.map(async (admin) => {
        const content = signupPendingEscalationEmail({
          locale: admin.preferredLocale,
          displayName: admin.displayName,
          signupDisplayName: signup.displayName,
          signupEmail: signup.email,
          pendingSince,
          pendingAge,
          reviewUrl,
        });
        await mail
          .send({
            to: admin.email,
            subject: content.subject,
            text: content.text,
            html: content.html,
          })
          .catch(() => undefined);
      }),
    );

    await input.database.db
      .update(users)
      .set({ signupPendingEscalatedAt: new Date() })
      .where(eq(users.id, signup.id));
    escalated += 1;
  }

  return { escalated };
}
