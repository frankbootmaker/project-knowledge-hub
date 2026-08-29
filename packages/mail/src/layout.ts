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

/**
 * Email-safe hex mirrors of apps/web Ops Console light tokens
 * (`oklch` brand/ink/surface from tokens.css).
 */
export const MAIL_COLORS = {
  brand: '#267d30',
  brandHover: '#0a6b1d',
  accent: '#299236',
  ink: '#121c23',
  inkMuted: '#5a656d',
  surface: '#f6f9fc',
  panel: '#ffffff',
  line: '#d9dfe3',
  onBrand: '#ffffff',
  mark: '#111811',
} as const;

export const MAIL_FONT =
  "'IBM Plex Sans', 'Segoe UI', Helvetica, Arial, sans-serif";
export const MAIL_FONT_DISPLAY =
  "'IBM Plex Sans Condensed', 'Segoe UI', Helvetica, Arial, sans-serif";
export const MAIL_FONT_MONO =
  "'IBM Plex Mono', Consolas, 'Courier New', monospace";

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
             style="display:inline-block;background:${c.ink};color:${c.onBrand};text-decoration:none;font-family:${MAIL_FONT};font-size:14px;font-weight:650;line-height:1.2;padding:12px 18px;border-radius:3px;border:1px solid ${c.ink};">
            ${escapeHtml(input.cta.label)}
          </a>
        </td>
      </tr>
      <tr>
        <td style="padding:16px 0 0;font-family:${MAIL_FONT};font-size:12px;line-height:1.5;color:${c.inkMuted};">
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
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${c.panel};border:1px solid ${c.line};border-radius:3px;">
          <tr>
            <td style="padding:20px 28px;border-bottom:1px solid ${c.line};">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td width="28" height="28" align="center" valign="middle" style="width:28px;height:28px;background:${c.mark};color:${c.onBrand};font-family:${MAIL_FONT_MONO};font-size:11px;font-weight:700;letter-spacing:0.02em;border-radius:3px;">
                    KH
                  </td>
                  <td style="padding-left:10px;">
                    ${
                      messages.brandName && messages.brandName !== messages.appName
                        ? `<p style="margin:0;font-family:${MAIL_FONT_MONO};font-size:11px;letter-spacing:0.09em;text-transform:uppercase;color:${c.brand};font-weight:650;">
                      ${escapeHtml(messages.brandName)}
                    </p>
                    <p style="margin:2px 0 0;font-family:${MAIL_FONT_DISPLAY};font-size:18px;font-weight:750;letter-spacing:-0.02em;color:${c.ink};">
                      ${escapeHtml(messages.appName)}
                    </p>`
                        : `<p style="margin:0;font-family:${MAIL_FONT_DISPLAY};font-size:18px;font-weight:750;letter-spacing:-0.02em;color:${c.ink};">
                      ${escapeHtml(messages.appName)}
                    </p>`
                    }
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:28px;">
              <h1 style="margin:0 0 16px;font-family:${MAIL_FONT_DISPLAY};font-size:22px;line-height:1.15;color:${c.ink};font-weight:750;letter-spacing:-0.02em;">
                ${escapeHtml(input.title)}
              </h1>
              <div style="font-family:${MAIL_FONT};font-size:15px;line-height:1.6;color:${c.ink};">
                ${input.bodyHtml}
              </div>
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:8px;">
                ${ctaBlock}
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 28px 22px;border-top:1px solid ${c.line};font-family:${MAIL_FONT};font-size:12px;line-height:1.5;color:${c.inkMuted};">
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
