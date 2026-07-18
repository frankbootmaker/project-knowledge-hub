/**
 * Build a plain-text excerpt around the first query match in markdown content.
 */
export function buildSnippet(
  content: string,
  query: string,
  options?: { maxLength?: number; context?: number },
): string {
  const maxLength = options?.maxLength ?? 220;
  const context = options?.context ?? 80;
  const plain = content
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`[\]()!-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!plain) {
    return '';
  }

  const tokens = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length > 1);

  const lower = plain.toLowerCase();
  let matchIndex = -1;
  let matchLength = 0;

  for (const token of tokens) {
    const index = lower.indexOf(token);
    if (index >= 0) {
      matchIndex = index;
      matchLength = token.length;
      break;
    }
  }

  if (matchIndex < 0) {
    return plain.length <= maxLength ? plain : `${plain.slice(0, maxLength).trimEnd()}…`;
  }

  const start = Math.max(0, matchIndex - context);
  const end = Math.min(plain.length, matchIndex + matchLength + context);
  let snippet = plain.slice(start, end).trim();
  if (start > 0) {
    snippet = `…${snippet}`;
  }
  if (end < plain.length) {
    snippet = `${snippet}…`;
  }
  if (snippet.length > maxLength) {
    snippet = `${snippet.slice(0, maxLength).trimEnd()}…`;
  }
  return snippet;
}
