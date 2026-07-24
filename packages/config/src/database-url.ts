/**
 * Build a postgres connection URL with percent-encoded credentials.
 *
 * Compose often embeds `${POSTGRES_PASSWORD}` into DATABASE_URL. Characters like
 * `&`, `#`, `@`, or `*` then break URL parsing or get mishandled by shells /
 * YAML, which shows up as `password authentication failed`.
 *
 * Prefer discrete POSTGRES_* env vars when present.
 */
export function resolveDatabaseUrl(
  source: NodeJS.ProcessEnv = process.env,
): string {
  const password = source.POSTGRES_PASSWORD;
  const hasDiscretePassword =
    typeof password === 'string' && password.length > 0;

  if (hasDiscretePassword) {
    const user = source.POSTGRES_USER?.trim() || 'knowledge_hub';
    const host = source.POSTGRES_HOST?.trim() || 'postgres';
    const port = source.POSTGRES_PORT?.trim() || '5432';
    const database = source.POSTGRES_DB?.trim() || 'knowledge_hub';
    return (
      `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}` +
      `@${host}:${port}/${encodeURIComponent(database)}`
    );
  }

  const fromUrl = source.DATABASE_URL?.trim();
  if (fromUrl) {
    return fromUrl;
  }

  throw new Error(
    'DATABASE_URL or POSTGRES_PASSWORD (+ optional POSTGRES_USER/DB/HOST) is required',
  );
}
