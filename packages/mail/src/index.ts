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
  setPasswordUrl,
} from './templates.js';
