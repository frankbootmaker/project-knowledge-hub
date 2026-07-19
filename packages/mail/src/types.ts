export type MailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

export type MailSendResult = {
  ok: boolean;
  driver: string;
  error?: string;
};

export interface MailTransport {
  readonly driver: string;
  send(message: MailMessage): Promise<MailSendResult>;
}

export type MailDriver = 'console' | 'smtp' | 'resend';

export type MailConfig = {
  driver: MailDriver;
  from: string;
  webUrl: string;
  smtp?: {
    host: string;
    port: number;
    secure: boolean;
    user?: string;
    pass?: string;
  };
  resendApiKey?: string;
};
