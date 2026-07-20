import {
  DEFAULT_APP_LOCALE,
  normalizeAppLocale,
  type AppLocale,
} from '@project-knowledge-hub/domain';
import { getMailMessages } from './messages.js';

export type { AppLocale };
export { DEFAULT_APP_LOCALE, normalizeAppLocale };

export function interpolate(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replaceAll(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? '');
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** Brand colors mirrored from apps/web tokens (light theme, inline for clients). */
export const MAIL_COLORS = {
  brand: '#1f4b73',
  brandHover: '#183a5a',
  ink: '#15202b',
  inkMuted: '#5b6b7c',
  surface: '#f4f7fa',
  panel: '#ffffff',
  line: '#d7e0ea',
  onBrand: '#ffffff',
} as const;

export type MailLayoutInput = {
  locale: AppLocale;
  title: string;
  /** Pre-escaped or trusted HTML paragraphs / blocks inside the card. */
  bodyHtml: string;
  cta?: { label: string; url: string };
  /** Plain-text lines for multipart alternative. */
  textLines: string[];
  subject: string;
};

export type LinkMailContent = {
  subject: string;
  text: string;
  html: string;
};

export function renderMailLayout(input: MailLayoutInput): LinkMailContent {
  const messages = getMailMessages(input.locale);
  const c = MAIL_COLORS;
  const ctaBlock = input.cta
    ? `
      <tr>
        <td style="padding:8px 0 4px;">
          <a href="${escapeHtml(input.cta.url)}"
             style="display:inline-block;background:${c.brand};color:${c.onBrand};text-decoration:none;font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;line-height:1.2;padding:12px 22px;border-radius:8px;">
            ${escapeHtml(input.cta.label)}
          </a>
        </td>
      </tr>
      <tr>
        <td style="padding:16px 0 0;font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;color:${c.inkMuted};">
          ${escapeHtml(messages.ctaFallback)}<br />
          <a href="${escapeHtml(input.cta.url)}" style="color:${c.brand};word-break:break-all;">${escapeHtml(input.cta.url)}</a>
        </td>
      </tr>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="${escapeHtml(input.locale)}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(input.title)}</title>
</head>
<body style="margin:0;padding:0;background:${c.surface};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${c.surface};padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${c.panel};border:1px solid ${c.line};border-radius:12px;overflow:hidden;">
          <tr>
            <td style="background:linear-gradient(135deg, ${c.brand} 0%, ${c.brandHover} 100%);padding:22px 28px;">
              <p style="margin:0;font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:rgba(255,255,255,0.78);font-weight:600;">
                ${escapeHtml(messages.brandName)}
              </p>
              <p style="margin:6px 0 0;font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:18px;font-weight:650;color:${c.onBrand};">
                ${escapeHtml(messages.appName)}
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:28px;">
              <h1 style="margin:0 0 16px;font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:22px;line-height:1.3;color:${c.ink};font-weight:650;">
                ${escapeHtml(input.title)}
              </h1>
              <div style="font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:${c.ink};">
                ${input.bodyHtml}
              </div>
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:8px;">
                ${ctaBlock}
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 28px 22px;border-top:1px solid ${c.line};font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;color:${c.inkMuted};">
              ${escapeHtml(messages.footerNote)}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`.trim();

  return {
    subject: input.subject,
    text: input.textLines.join('\n'),
    html,
  };
}

export function p(text: string): string {
  return `<p style="margin:0 0 12px;">${escapeHtml(text)}</p>`;
}
