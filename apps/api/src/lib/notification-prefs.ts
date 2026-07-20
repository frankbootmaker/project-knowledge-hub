import {
  allowsEmailNotification,
  type EmailNotificationKey,
} from '@project-knowledge-hub/domain';

/** Returns false when the user has muted this optional product email. */
export function shouldSendOptionalEmail(
  prefs: unknown,
  key: EmailNotificationKey,
): boolean {
  return allowsEmailNotification(prefs, key);
}
