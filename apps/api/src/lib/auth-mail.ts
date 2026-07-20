import {
  inviteEmail,
  passwordResetEmail,
  emailConfirmEmail,
  accountApprovedEmail,
  setPasswordUrl,
  confirmEmailUrl,
  loginUrl,
  type MailSendResult,
  type MailTransport,
} from '@project-knowledge-hub/mail';

export async function sendPasswordResetMail(
  mail: MailTransport,
  input: {
    webUrl: string;
    to: string;
    displayName: string;
    rawToken: string;
  },
): Promise<MailSendResult> {
  const actionUrl = setPasswordUrl(input.webUrl, input.rawToken);
  const content = passwordResetEmail({
    displayName: input.displayName,
    actionUrl,
  });
  return mail.send({
    to: input.to,
    subject: content.subject,
    text: content.text,
    html: content.html,
  });
}

export async function sendInviteMail(
  mail: MailTransport,
  input: {
    webUrl: string;
    to: string;
    displayName: string;
    rawToken: string;
  },
): Promise<MailSendResult> {
  const actionUrl = setPasswordUrl(input.webUrl, input.rawToken);
  const content = inviteEmail({
    displayName: input.displayName,
    actionUrl,
  });
  return mail.send({
    to: input.to,
    subject: content.subject,
    text: content.text,
    html: content.html,
  });
}

export async function sendEmailConfirmMail(
  mail: MailTransport,
  input: {
    webUrl: string;
    to: string;
    displayName: string;
    rawToken: string;
  },
): Promise<MailSendResult> {
  const actionUrl = confirmEmailUrl(input.webUrl, input.rawToken);
  const content = emailConfirmEmail({
    displayName: input.displayName,
    actionUrl,
  });
  return mail.send({
    to: input.to,
    subject: content.subject,
    text: content.text,
    html: content.html,
  });
}

export async function sendAccountApprovedMail(
  mail: MailTransport,
  input: {
    webUrl: string;
    to: string;
    displayName: string;
  },
): Promise<MailSendResult> {
  const content = accountApprovedEmail({
    displayName: input.displayName,
    loginUrl: loginUrl(input.webUrl),
  });
  return mail.send({
    to: input.to,
    subject: content.subject,
    text: content.text,
    html: content.html,
  });
}

export function mailDeliveryMeta(result: MailSendResult): {
  sent: boolean;
  driver: string;
  warning?: string;
} {
  if (!result.ok) {
    return {
      sent: false,
      driver: result.driver,
      warning: result.error ?? 'Failed to send email',
    };
  }
  if (result.driver === 'console') {
    return {
      sent: true,
      driver: result.driver,
      warning: 'Email logged to console (MAIL_DRIVER=console)',
    };
  }
  return { sent: true, driver: result.driver };
}
