import {
  normalizeAppLocale,
  type AppLocale,
} from '@project-knowledge-hub/domain';
import {
  interpolate,
  p,
  renderMailLayout,
  type LinkMailContent,
} from './layout.js';
import { getMailMessages } from './messages.js';

export type { LinkMailContent };

function displayNameOrFallback(displayName: string, locale: AppLocale): string {
  const trimmed = displayName.trim();
  if (trimmed) return trimmed;
  if (locale === 'de') return 'dort';
  if (locale === 'hu') return 'Ott';
  return 'there';
}

export function passwordResetEmail(input: {
  locale?: string | null;
  displayName: string;
  actionUrl: string;
}): LinkMailContent {
  const locale = normalizeAppLocale(input.locale);
  const m = getMailMessages(locale).passwordReset;
  const name = displayNameOrFallback(input.displayName, locale);
  const greeting = interpolate(m.greeting, { name });
  return renderMailLayout({
    locale,
    subject: m.subject,
    title: m.title,
    bodyHtml: `${p(greeting)}${p(m.body)}${p(m.ignore)}`,
    cta: { label: m.cta, url: input.actionUrl },
    textLines: [
      greeting,
      '',
      m.body,
      input.actionUrl,
      '',
      m.ignore,
    ],
  });
}

export function inviteEmail(input: {
  locale?: string | null;
  displayName: string;
  actionUrl: string;
}): LinkMailContent {
  const locale = normalizeAppLocale(input.locale);
  const m = getMailMessages(locale).invite;
  const name = displayNameOrFallback(input.displayName, locale);
  const greeting = interpolate(m.greeting, { name });
  return renderMailLayout({
    locale,
    subject: m.subject,
    title: m.title,
    bodyHtml: `${p(greeting)}${p(m.body)}${p(m.ignore)}`,
    cta: { label: m.cta, url: input.actionUrl },
    textLines: [greeting, '', m.body, input.actionUrl, '', m.ignore],
  });
}

export function emailConfirmEmail(input: {
  locale?: string | null;
  displayName: string;
  actionUrl: string;
}): LinkMailContent {
  const locale = normalizeAppLocale(input.locale);
  const m = getMailMessages(locale).emailConfirm;
  const name = displayNameOrFallback(input.displayName, locale);
  const greeting = interpolate(m.greeting, { name });
  return renderMailLayout({
    locale,
    subject: m.subject,
    title: m.title,
    bodyHtml: `${p(greeting)}${p(m.body)}${p(m.after)}${p(m.ignore)}`,
    cta: { label: m.cta, url: input.actionUrl },
    textLines: [greeting, '', m.body, '', m.after, input.actionUrl, '', m.ignore],
  });
}

export function accountApprovedEmail(input: {
  locale?: string | null;
  displayName: string;
  loginUrl: string;
}): LinkMailContent {
  const locale = normalizeAppLocale(input.locale);
  const m = getMailMessages(locale).accountApproved;
  const name = displayNameOrFallback(input.displayName, locale);
  const greeting = interpolate(m.greeting, { name });
  return renderMailLayout({
    locale,
    subject: m.subject,
    title: m.title,
    bodyHtml: `${p(greeting)}${p(m.body)}`,
    cta: { label: m.cta, url: input.loginUrl },
    textLines: [greeting, '', m.body, input.loginUrl],
  });
}

export function passwordChangedEmail(input: {
  locale?: string | null;
  displayName: string;
  loginUrl: string;
}): LinkMailContent {
  const locale = normalizeAppLocale(input.locale);
  const m = getMailMessages(locale).passwordChanged;
  const name = displayNameOrFallback(input.displayName, locale);
  const greeting = interpolate(m.greeting, { name });
  return renderMailLayout({
    locale,
    subject: m.subject,
    title: m.title,
    bodyHtml: `${p(greeting)}${p(m.body)}${p(m.bodyExtra)}`,
    cta: { label: m.cta, url: input.loginUrl },
    textLines: [greeting, '', m.body, '', m.bodyExtra, input.loginUrl],
  });
}

export function accountClosedEmail(input: {
  locale?: string | null;
  displayName: string;
}): LinkMailContent {
  const locale = normalizeAppLocale(input.locale);
  const m = getMailMessages(locale).accountClosed;
  const name = displayNameOrFallback(input.displayName, locale);
  const greeting = interpolate(m.greeting, { name });
  return renderMailLayout({
    locale,
    subject: m.subject,
    title: m.title,
    bodyHtml: `${p(greeting)}${p(m.body)}${p(m.bodyExtra)}`,
    textLines: [greeting, '', m.body, '', m.bodyExtra],
  });
}

export function signupRejectedEmail(input: {
  locale?: string | null;
  displayName: string;
}): LinkMailContent {
  const locale = normalizeAppLocale(input.locale);
  const m = getMailMessages(locale).signupRejected;
  const name = displayNameOrFallback(input.displayName, locale);
  const greeting = interpolate(m.greeting, { name });
  return renderMailLayout({
    locale,
    subject: m.subject,
    title: m.title,
    bodyHtml: `${p(greeting)}${p(m.body)}`,
    textLines: [greeting, '', m.body],
  });
}

function agentLine(locale: AppLocale, agentName: string | null | undefined): string {
  const label = (agentName ?? '').trim() || 'AI';
  return interpolate(getMailMessages(locale).aiConnectionPending.agentLabel, {
    agent: label,
  });
}

export function aiConnectionPendingEmail(input: {
  locale?: string | null;
  displayName: string;
  agentName?: string | null;
  manageUrl: string;
}): LinkMailContent {
  const locale = normalizeAppLocale(input.locale);
  const m = getMailMessages(locale).aiConnectionPending;
  const name = displayNameOrFallback(input.displayName, locale);
  const greeting = interpolate(m.greeting, { name });
  const agent = agentLine(locale, input.agentName);
  return renderMailLayout({
    locale,
    subject: m.subject,
    title: m.title,
    bodyHtml: `${p(greeting)}${p(m.body)}${p(agent)}`,
    cta: { label: m.cta, url: input.manageUrl },
    textLines: [greeting, '', m.body, agent, input.manageUrl],
  });
}

export function aiConnectionApprovedEmail(input: {
  locale?: string | null;
  displayName: string;
  agentName?: string | null;
  manageUrl: string;
}): LinkMailContent {
  const locale = normalizeAppLocale(input.locale);
  const m = getMailMessages(locale).aiConnectionApproved;
  const name = displayNameOrFallback(input.displayName, locale);
  const greeting = interpolate(m.greeting, { name });
  const agent = interpolate(m.agentLabel, {
    agent: (input.agentName ?? '').trim() || 'AI',
  });
  return renderMailLayout({
    locale,
    subject: m.subject,
    title: m.title,
    bodyHtml: `${p(greeting)}${p(m.body)}${p(agent)}`,
    cta: { label: m.cta, url: input.manageUrl },
    textLines: [greeting, '', m.body, agent, input.manageUrl],
  });
}

export function aiConnectionRejectedEmail(input: {
  locale?: string | null;
  displayName: string;
  agentName?: string | null;
  manageUrl: string;
}): LinkMailContent {
  const locale = normalizeAppLocale(input.locale);
  const m = getMailMessages(locale).aiConnectionRejected;
  const name = displayNameOrFallback(input.displayName, locale);
  const greeting = interpolate(m.greeting, { name });
  const agent = interpolate(m.agentLabel, {
    agent: (input.agentName ?? '').trim() || 'AI',
  });
  return renderMailLayout({
    locale,
    subject: m.subject,
    title: m.title,
    bodyHtml: `${p(greeting)}${p(m.body)}${p(agent)}`,
    cta: { label: m.cta, url: input.manageUrl },
    textLines: [greeting, '', m.body, agent, input.manageUrl],
  });
}

export function testEmail(input: {
  locale?: string | null;
  displayName: string;
  driver: string;
  source: string;
  from: string;
  settingsUrl: string;
}): LinkMailContent {
  const locale = normalizeAppLocale(input.locale);
  const m = getMailMessages(locale).testEmail;
  const name = displayNameOrFallback(input.displayName, locale);
  const greeting = interpolate(m.greeting, { name });
  const driverLine = interpolate(m.driverLabel, { driver: input.driver });
  const sourceLine = interpolate(m.sourceLabel, { source: input.source });
  const fromLine = interpolate(m.fromLabel, { from: input.from });
  return renderMailLayout({
    locale,
    subject: m.subject,
    title: m.title,
    bodyHtml: `${p(greeting)}${p(m.body)}${p(driverLine)}${p(sourceLine)}${p(fromLine)}`,
    cta: { label: m.cta, url: input.settingsUrl },
    textLines: [
      greeting,
      '',
      m.body,
      '',
      driverLine,
      sourceLine,
      fromLine,
      '',
      input.settingsUrl,
    ],
  });
}

export function setPasswordUrl(webUrl: string, token: string): string {
  const base = webUrl.replace(/\/$/, '');
  const url = new URL('/set-password', `${base}/`);
  url.searchParams.set('token', token);
  return url.toString();
}

export function confirmEmailUrl(webUrl: string, token: string): string {
  const base = webUrl.replace(/\/$/, '');
  const url = new URL('/confirm-email', `${base}/`);
  url.searchParams.set('token', token);
  return url.toString();
}

export function loginUrl(webUrl: string): string {
  const base = webUrl.replace(/\/$/, '');
  return new URL('/login', `${base}/`).toString();
}

export function aiConnectionsUrl(webUrl: string): string {
  const base = webUrl.replace(/\/$/, '');
  return new URL('/account/ai-connections', `${base}/`).toString();
}

export function mailSettingsUrl(webUrl: string): string {
  const base = webUrl.replace(/\/$/, '');
  return new URL('/admin/email', `${base}/`).toString();
}
