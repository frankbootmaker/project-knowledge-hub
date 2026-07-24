import { describe, expect, it } from 'vitest';
import { resolveDatabaseUrl } from './database-url.js';

describe('resolveDatabaseUrl', () => {
  it('percent-encodes special characters from discrete POSTGRES_* vars', () => {
    const url = resolveDatabaseUrl({
      POSTGRES_USER: 'knowledge_hub',
      POSTGRES_PASSWORD: 'O*Ytq6&tdF3Ps51',
      POSTGRES_DB: 'knowledge_hub',
      POSTGRES_HOST: 'postgres',
    });

    expect(url).toBe(
      `postgres://knowledge_hub:${encodeURIComponent('O*Ytq6&tdF3Ps51')}@postgres:5432/knowledge_hub`,
    );
    // encodeURIComponent encodes `&` but leaves `*` unescaped (RFC 3986 "unreserved"-ish set).
    expect(url).toContain('%26');
    expect(url).toContain('O*Ytq6');
  });
  it('falls back to DATABASE_URL when POSTGRES_PASSWORD is unset', () => {
    expect(
      resolveDatabaseUrl({
        DATABASE_URL: 'postgres://u:p@localhost:5432/db',
      }),
    ).toBe('postgres://u:p@localhost:5432/db');
  });

  it('prefers discrete password over DATABASE_URL', () => {
    const url = resolveDatabaseUrl({
      DATABASE_URL: 'postgres://old:wrong@postgres:5432/knowledge_hub',
      POSTGRES_USER: 'knowledge_hub',
      POSTGRES_PASSWORD: 'a&b',
      POSTGRES_DB: 'knowledge_hub',
    });
    expect(url).toContain(encodeURIComponent('a&b'));
    expect(url).not.toContain('wrong');
  });
});
