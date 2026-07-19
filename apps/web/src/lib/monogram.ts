/** Two-letter monogram from full name or display name. */
export function userMonogram(displayName: string, fullName?: string | null): string {
  const source = (fullName?.trim() || displayName).trim();
  if (!source) return '?';
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    const a = parts[0]?.[0] ?? '';
    const b = parts[1]?.[0] ?? '';
    return `${a}${b}`.toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}
