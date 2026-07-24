export type {
  MailConfig,
  MailDriver,
  MailMessage,
  MailSendResult,
  MailTransport,
} from './types.js';
export { createMailTransport } from './create-transport.js';
export { ConsoleMailTransport } from './console.js';
export { SmtpMailTransport } from './smtp.js';
export { ResendMailTransport } from './resend.js';
export {
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
  testEmail,
  setPasswordUrl,
  confirmEmailUrl,
  loginUrl,
  adminUsersPendingUrl,
  aiConnectionsUrl,
  mailSettingsUrl,
} from './templates.js';
export { renderMailLayout, MAIL_COLORS } from './layout.js';
export { getMailMessages } from './messages.js';
