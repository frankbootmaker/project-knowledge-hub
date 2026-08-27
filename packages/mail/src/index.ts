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
export {
  ResendMailTransport,
  DEFAULT_RESEND_BASE_URL,
  normalizeResendBaseUrl,
} from './resend.js';
export {
  inviteEmail,
  passwordResetEmail,
  emailConfirmEmail,
  accountApprovedEmail,
  signupPendingApprovalEmail,
  ssoUserProvisionedEmail,
  signupPendingEscalationEmail,
  backupStaleAlertEmail,
  opsAlertEmail,
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
  adminUsersUrl,
  adminMonitoringUrl,
  aiConnectionsUrl,
  mailSettingsUrl,
} from './templates.js';
export {
  renderMailLayout,
  MAIL_COLORS,
  interpolate,
  normalizeAppLocale,
} from './layout.js';
export { getMailMessages } from './messages.js';
