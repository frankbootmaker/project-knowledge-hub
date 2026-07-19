export type LinkMailContent = {
  subject: string;
  text: string;
  html: string;
};

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function passwordResetEmail(input: {
  displayName: string;
  actionUrl: string;
}): LinkMailContent {
  const name = input.displayName.trim() || 'there';
  const subject = 'Reset your Project Knowledge Hub password';
  const text = [
    `Hi ${name},`,
    '',
    'We received a request to reset your password.',
    `Open this link to choose a new password (expires soon):`,
    input.actionUrl,
    '',
    'If you did not request this, you can ignore this email.',
  ].join('\n');
  const html = `
<p>Hi ${escapeHtml(name)},</p>
<p>We received a request to reset your password.</p>
<p><a href="${escapeHtml(input.actionUrl)}">Choose a new password</a></p>
<p>If you did not request this, you can ignore this email.</p>
`.trim();
  return { subject, text, html };
}

export function inviteEmail(input: {
  displayName: string;
  actionUrl: string;
}): LinkMailContent {
  const name = input.displayName.trim() || 'there';
  const subject = 'You are invited to Project Knowledge Hub';
  const text = [
    `Hi ${name},`,
    '',
    'You have been invited to Project Knowledge Hub.',
    `Open this link to set your password and activate your account:`,
    input.actionUrl,
    '',
    'If you were not expecting this invitation, you can ignore this email.',
  ].join('\n');
  const html = `
<p>Hi ${escapeHtml(name)},</p>
<p>You have been invited to Project Knowledge Hub.</p>
<p><a href="${escapeHtml(input.actionUrl)}">Set your password</a></p>
<p>If you were not expecting this invitation, you can ignore this email.</p>
`.trim();
  return { subject, text, html };
}

export function setPasswordUrl(webUrl: string, token: string): string {
  const base = webUrl.replace(/\/$/, '');
  const url = new URL('/set-password', `${base}/`);
  url.searchParams.set('token', token);
  return url.toString();
}
