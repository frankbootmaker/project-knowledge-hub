import {
  inviteEmail,
  passwordResetEmail,
  emailConfirmEmail,
  accountApprovedEmail,
  signupPendingApprovalEmail,
  signupPendingEscalationEmail,
  passwordChangedEmail,
  accountClosedEmail,
  signupRejectedEmail,
  aiConnectionPendingEmail,
  aiConnectionApprovedEmail,
  aiConnectionRejectedEmail,
  setPasswordUrl,
  confirmEmailUrl,
  loginUrl,
  adminUsersPendingUrl,
  aiConnectionsUrl,
  type MailSendResult,
  type MailTransport,
} from '@project-knowledge-hub/mail';

type LocaleInput = {
  locale?: string | null;
};

export async function sendPasswordResetMail(
  mail: MailTransport,
  input: {
    webUrl: string;
    to: string;
    displayName: string;
    rawToken: string;
  } & LocaleInput,
): Promise<MailSendResult> {
  const actionUrl = setPasswordUrl(input.webUrl, input.rawToken);
  const content = passwordResetEmail({
    locale: input.locale,
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
  } & LocaleInput,
): Promise<MailSendResult> {
  const actionUrl = setPasswordUrl(input.webUrl, input.rawToken);
  const content = inviteEmail({
    locale: input.locale,
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
  } & LocaleInput,
): Promise<MailSendResult> {
  const actionUrl = confirmEmailUrl(input.webUrl, input.rawToken);
  const content = emailConfirmEmail({
    locale: input.locale,
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
    memberships?: Array<{ workspaceName: string; role: string }>;
  } & LocaleInput,
): Promise<MailSendResult> {
  const content = accountApprovedEmail({
    locale: input.locale,
    displayName: input.displayName,
    loginUrl: loginUrl(input.webUrl),
    memberships: input.memberships,
  });
  return mail.send({
    to: input.to,
    subject: content.subject,
    text: content.text,
    html: content.html,
  });
}

export async function sendSignupPendingApprovalMail(
  mail: MailTransport,
  input: {
    webUrl: string;
    to: string;
    displayName: string;
    signupDisplayName: string;
    signupEmail: string;
  } & LocaleInput,
): Promise<MailSendResult> {
  const content = signupPendingApprovalEmail({
    locale: input.locale,
    displayName: input.displayName,
    signupDisplayName: input.signupDisplayName,
    signupEmail: input.signupEmail,
    reviewUrl: adminUsersPendingUrl(input.webUrl),
  });
  return mail.send({
    to: input.to,
    subject: content.subject,
    text: content.text,
    html: content.html,
  });
}

export async function sendSignupPendingEscalationMail(
  mail: MailTransport,
  input: {
    webUrl: string;
    to: string;
    displayName: string;
    signupDisplayName: string;
    signupEmail: string;
    pendingSince: string;
    pendingAge: string;
  } & LocaleInput,
): Promise<MailSendResult> {
  const content = signupPendingEscalationEmail({
    locale: input.locale,
    displayName: input.displayName,
    signupDisplayName: input.signupDisplayName,
    signupEmail: input.signupEmail,
    pendingSince: input.pendingSince,
    pendingAge: input.pendingAge,
    reviewUrl: adminUsersPendingUrl(input.webUrl),
  });
  return mail.send({
    to: input.to,
    subject: content.subject,
    text: content.text,
    html: content.html,
  });
}

export async function sendPasswordChangedMail(
  mail: MailTransport,
  input: {
    webUrl: string;
    to: string;
    displayName: string;
  } & LocaleInput,
): Promise<MailSendResult> {
  const content = passwordChangedEmail({
    locale: input.locale,
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

export async function sendAccountClosedMail(
  mail: MailTransport,
  input: {
    to: string;
    displayName: string;
  } & LocaleInput,
): Promise<MailSendResult> {
  const content = accountClosedEmail({
    locale: input.locale,
    displayName: input.displayName,
  });
  return mail.send({
    to: input.to,
    subject: content.subject,
    text: content.text,
    html: content.html,
  });
}

export async function sendSignupRejectedMail(
  mail: MailTransport,
  input: {
    to: string;
    displayName: string;
  } & LocaleInput,
): Promise<MailSendResult> {
  const content = signupRejectedEmail({
    locale: input.locale,
    displayName: input.displayName,
  });
  return mail.send({
    to: input.to,
    subject: content.subject,
    text: content.text,
    html: content.html,
  });
}

export async function sendAiConnectionPendingMail(
  mail: MailTransport,
  input: {
    webUrl: string;
    to: string;
    displayName: string;
    agentName?: string | null;
  } & LocaleInput,
): Promise<MailSendResult> {
  const content = aiConnectionPendingEmail({
    locale: input.locale,
    displayName: input.displayName,
    agentName: input.agentName,
    manageUrl: aiConnectionsUrl(input.webUrl),
  });
  return mail.send({
    to: input.to,
    subject: content.subject,
    text: content.text,
    html: content.html,
  });
}

export async function sendAiConnectionApprovedMail(
  mail: MailTransport,
  input: {
    webUrl: string;
    to: string;
    displayName: string;
    agentName?: string | null;
  } & LocaleInput,
): Promise<MailSendResult> {
  const content = aiConnectionApprovedEmail({
    locale: input.locale,
    displayName: input.displayName,
    agentName: input.agentName,
    manageUrl: aiConnectionsUrl(input.webUrl),
  });
  return mail.send({
    to: input.to,
    subject: content.subject,
    text: content.text,
    html: content.html,
  });
}

export async function sendAiConnectionRejectedMail(
  mail: MailTransport,
  input: {
    webUrl: string;
    to: string;
    displayName: string;
    agentName?: string | null;
  } & LocaleInput,
): Promise<MailSendResult> {
  const content = aiConnectionRejectedEmail({
    locale: input.locale,
    displayName: input.displayName,
    agentName: input.agentName,
    manageUrl: aiConnectionsUrl(input.webUrl),
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
