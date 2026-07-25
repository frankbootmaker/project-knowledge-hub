/**
 * Strip characters that break HTTP Authorization headers (quotes, CR/LF)
 * and accidental whitespace from Dokploy / .env paste.
 */
export function sanitizeS3Credential(value: string): string {
  let next = value.replace(/[\r\n\0]/g, '').trim();
  if (
    (next.startsWith('"') && next.endsWith('"') && next.length >= 2) ||
    (next.startsWith("'") && next.endsWith("'") && next.length >= 2)
  ) {
    next = next.slice(1, -1).trim();
  }
  return next;
}
