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
  memberships?: Array<{ workspaceName: string; role: string }>;
}): LinkMailContent {
  const locale = normalizeAppLocale(input.locale);
  const m = getMailMessages(locale).accountApproved;
  const name = displayNameOrFallback(input.displayName, locale);
  const greeting = interpolate(m.greeting, { name });

  const roleLabel = (role: string): string => {
    if (role === 'workspace_admin') return m.roleWorkspaceAdmin;
    if (role === 'maintainer') return m.roleMaintainer;
    if (role === 'reader') return m.roleReader;
    return role;
  };

  const membershipLines = (input.memberships ?? []).map((item) =>
    interpolate(m.membershipLine, {
      workspace: item.workspaceName,
      role: roleLabel(item.role),
    }),
  );

  const membershipHtml =
    membershipLines.length > 0
      ? `${p(m.membershipsIntro)}<ul>${membershipLines
          .map((line) => `<li>${line}</li>`)
          .join('')}</ul>`
      : '';

  const textExtra =
    membershipLines.length > 0
      ? ['', m.membershipsIntro, ...membershipLines.map((line) => `• ${line}`)]
      : [];

  return renderMailLayout({
    locale,
    subject: m.subject,
    title: m.title,
    bodyHtml: `${p(greeting)}${p(m.body)}${membershipHtml}`,
    cta: { label: m.cta, url: input.loginUrl },
    textLines: [greeting, '', m.body, ...textExtra, '', input.loginUrl],
  });
}

export function signupPendingApprovalEmail(input: {
  locale?: string | null;
  displayName: string;
  signupDisplayName: string;
  signupEmail: string;
  reviewUrl: string;
}): LinkMailContent {
  const locale = normalizeAppLocale(input.locale);
  const m = getMailMessages(locale).signupPendingApproval;
  const name = displayNameOrFallback(input.displayName, locale);
  const greeting = interpolate(m.greeting, { name });
  const userLine = interpolate(m.userLabel, { user: input.signupDisplayName });
  const emailLine = interpolate(m.emailLabel, { email: input.signupEmail });
  return renderMailLayout({
    locale,
    subject: m.subject,
    title: m.title,
    bodyHtml: `${p(greeting)}${p(m.body)}${p(userLine)}${p(emailLine)}`,
    cta: { label: m.cta, url: input.reviewUrl },
    textLines: [greeting, '', m.body, '', userLine, emailLine, '', input.reviewUrl],
  });
}

export function signupPendingEscalationEmail(input: {
  locale?: string | null;
  displayName: string;
  signupDisplayName: string;
  signupEmail: string;
  pendingSince: string;
  pendingAge: string;
  reviewUrl: string;
}): LinkMailContent {
  const locale = normalizeAppLocale(input.locale);
  const m = getMailMessages(locale).signupPendingEscalation;
  const name = displayNameOrFallback(input.displayName, locale);
  const greeting = interpolate(m.greeting, { name });
  const userLine = interpolate(m.userLabel, { user: input.signupDisplayName });
  const emailLine = interpolate(m.emailLabel, { email: input.signupEmail });
  const sinceLine = interpolate(m.pendingSinceLabel, {
    since: input.pendingSince,
    age: input.pendingAge,
  });
  return renderMailLayout({
    locale,
    subject: m.subject,
    title: m.title,
    bodyHtml: `${p(greeting)}${p(m.body)}${p(userLine)}${p(emailLine)}${p(sinceLine)}`,
    cta: { label: m.cta, url: input.reviewUrl },
    textLines: [
      greeting,
      '',
      m.body,
      '',
      userLine,
      emailLine,
      sinceLine,
      '',
      input.reviewUrl,
    ],
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

export function adminUsersPendingUrl(webUrl: string): string {
  const base = webUrl.replace(/\/$/, '');
  const url = new URL('/admin/users', `${base}/`);
  url.searchParams.set('status', 'pending_approval');
  return url.toString();
}

export function aiConnectionsUrl(webUrl: string): string {
  const base = webUrl.replace(/\/$/, '');
  return new URL('/account/ai-connections', `${base}/`).toString();
}

export function mailSettingsUrl(webUrl: string): string {
  const base = webUrl.replace(/\/$/, '');
  return new URL('/admin/email', `${base}/`).toString();
}
