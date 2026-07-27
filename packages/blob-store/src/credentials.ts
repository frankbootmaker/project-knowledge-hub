/**
 * Strip characters that break HTTP Authorization headers and accidental
 * Dokploy / .env paste noise (quotes, CR/LF, NBSP, non-ASCII controls).
 * Keeps printable ASCII only (AWS keys/secrets are ASCII).
 */
export function sanitizeS3Credential(value: string): string {
  let next = value
    // Intentionally strip C0 controls / BOM / ZW* from pasted secrets.
    // eslint-disable-next-line no-control-regex -- credential sanitization
    .replace(/[\u0000-\u001F\u007F\u00A0\u200B-\u200D\uFEFF]/g, '')
    .trim();
  if (
    (next.startsWith('"') && next.endsWith('"') && next.length >= 2) ||
    (next.startsWith("'") && next.endsWith("'") && next.length >= 2) ||
    (next.startsWith('“') && next.endsWith('”') && next.length >= 2) ||
    (next.startsWith('‘') && next.endsWith('’') && next.length >= 2)
  ) {
    next = next.slice(1, -1).trim();
  }
  // Drop any remaining non-printable-ASCII (Node rejects these in headers).
  next = next.replace(/[^\x21-\x7E]/g, '');
  return next;
}

export function isBlobCredentialHeaderError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.message.includes('authorization') ||
    error.message.includes('Invalid character') ||
    (error as { code?: string }).code === 'ERR_INVALID_CHAR'
  );
}
