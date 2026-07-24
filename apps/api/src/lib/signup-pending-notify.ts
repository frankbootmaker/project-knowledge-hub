import { and, eq } from 'drizzle-orm';
import {
  allowsEmailNotification,
  mergeEmailNotificationPrefs,
} from '@project-knowledge-hub/domain';
import { users, type Database } from '@project-knowledge-hub/database';
import type { MailTransport } from '@project-knowledge-hub/mail';
import { sendSignupPendingApprovalMail } from './auth-mail.js';

export type OnDutyAdmin = {
  id: string;
  displayName: string;
  email: string;
};

export async function listActiveSystemAdmins(
  database: Database,
): Promise<
  Array<{
    id: string;
    displayName: string;
    email: string;
    preferredLocale: string;
    emailNotificationPrefs: unknown;
  }>
> {
  return database.db
    .select({
      id: users.id,
      displayName: users.displayName,
      email: users.email,
      preferredLocale: users.preferredLocale,
      emailNotificationPrefs: users.emailNotificationPrefs,
    })
    .from(users)
    .where(and(eq(users.isSystemAdmin, true), eq(users.status, 'active')));
}

export async function listOnDutyAdmins(
  database: Database,
): Promise<OnDutyAdmin[]> {
  const admins = await listActiveSystemAdmins(database);
  return admins
    .filter((admin) =>
      allowsEmailNotification(admin.emailNotificationPrefs, 'signupPendingApproval'),
    )
    .map((admin) => ({
      id: admin.id,
      displayName: admin.displayName,
      email: admin.email,
    }));
}

/** Immediate notify: on-duty admins, or all system admins if none opted in. */
export async function notifyAdminsOfSignupPendingApproval(input: {
  database: Database;
  mail: MailTransport;
  webUrl: string;
  signup: { displayName: string; email: string };
}): Promise<{ recipientCount: number; usedFallback: boolean }> {
  const admins = await listActiveSystemAdmins(input.database);
  if (admins.length === 0) {
    return { recipientCount: 0, usedFallback: false };
  }

  const onDuty = admins.filter((admin) =>
    allowsEmailNotification(admin.emailNotificationPrefs, 'signupPendingApproval'),
  );
  const recipients = onDuty.length > 0 ? onDuty : admins;
  const usedFallback = onDuty.length === 0;

  await Promise.all(
    recipients.map((admin) =>
      sendSignupPendingApprovalMail(input.mail, {
        webUrl: input.webUrl,
        to: admin.email,
        displayName: admin.displayName,
        signupDisplayName: input.signup.displayName,
        signupEmail: input.signup.email,
        locale: admin.preferredLocale,
      }).catch(() => undefined),
    ),
  );

  return { recipientCount: recipients.length, usedFallback };
}

export function adminHasSignupPendingPref(prefs: unknown): boolean {
  return mergeEmailNotificationPrefs(prefs).signupPendingApproval;
}
