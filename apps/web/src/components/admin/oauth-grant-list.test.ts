import { describe, expect, it } from 'vitest';
import {
  defaultOauthGrantListQuery,
  filterOauthGrants,
  oauthClientLabel,
  oauthClientOptions,
  oauthGrantFiltersActive,
  oauthGrantListStatus,
  type OauthGrantListFields,
} from './oauth-grant-list';

const NOW = Date.parse('2026-10-21T12:00:00.000Z');

function grant(
  overrides: Partial<OauthGrantListFields> & Pick<OauthGrantListFields, 'id' | 'clientHost'>,
): OauthGrantListFields {
  return {
    scopes: ['projects:read'],
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('oauthClientLabel', () => {
  it('derives ChatGPT, Claude, and Codex from the host', () => {
    expect(oauthClientLabel('chatgpt.com')).toBe('ChatGPT');
    expect(oauthClientLabel('https://chatgpt.com')).toBe('ChatGPT');
    expect(oauthClientLabel('auth.openai.com')).toBe('ChatGPT');
    expect(oauthClientLabel('claude.ai')).toBe('Claude');
    expect(oauthClientLabel('codex.local')).toBe('Codex');
    expect(oauthClientLabel('127.0.0.1')).toBe('127.0.0.1');
  });
});

describe('oauthGrantListStatus', () => {
  it('derives expired from refreshExpiresAt', () => {
    expect(
      oauthGrantListStatus({ status: 'active', refreshExpiresAt: '2026-10-21T12:00:00.000Z' }, NOW),
    ).toBe('expired');
    expect(
      oauthGrantListStatus({ status: 'active', refreshExpiresAt: '2026-10-22T00:00:00.000Z' }, NOW),
    ).toBe('active');
    expect(oauthGrantListStatus({ status: 'active', refreshExpiresAt: null }, NOW)).toBe('active');
  });

  it('keeps a revoked grant revoked after the refresh expiry', () => {
    const past = '2020-01-01T00:00:00.000Z';
    expect(
      oauthGrantListStatus({ status: 'revoked', refreshExpiresAt: past, revokedAt: past }, NOW),
    ).toBe('revoked');
    expect(
      oauthGrantListStatus({ status: 'active', revokedAt: past, refreshExpiresAt: null }, NOW),
    ).toBe('revoked');
  });
});

describe('filterOauthGrants', () => {
  const rows = [
    grant({
      id: 'g-chatgpt',
      clientHost: 'chatgpt.com',
      clientId: 'https://chatgpt.com/oauth/client-a',
      userDisplayName: 'Ada Lovelace',
      userEmail: 'ada@example.com',
      scopes: ['projects:read'],
      createdAt: '2026-04-01T00:00:00.000Z',
      lastUsedAt: '2026-10-02T00:00:00.000Z',
      refreshExpiresAt: '2027-01-01T00:00:00.000Z',
    }),
    grant({
      id: 'g-claude',
      clientHost: 'claude.ai',
      clientId: 'https://claude.ai/oauth/client-b',
      userDisplayName: 'Grace Hopper',
      userEmail: 'grace@example.com',
      scopes: ['knowledge:read'],
      createdAt: '2026-09-01T00:00:00.000Z',
      lastUsedAt: null,
      refreshExpiresAt: '2026-01-01T00:00:00.000Z',
    }),
    grant({
      id: 'g-revoked',
      clientHost: 'chatgpt.com',
      clientId: 'https://chatgpt.com/oauth/client-c',
      userDisplayName: 'Alan Turing',
      userEmail: 'alan@example.com',
      status: 'revoked',
      revokedAt: '2026-08-01T00:00:00.000Z',
      createdAt: '2026-02-01T00:00:00.000Z',
      lastUsedAt: '2026-03-01T00:00:00.000Z',
      refreshExpiresAt: '2020-01-01T00:00:00.000Z',
    }),
  ];

  it('searches client label, host, client id, and user name or email', () => {
    const base = defaultOauthGrantListQuery();
    expect(filterOauthGrants(rows, { ...base, query: 'claude' }, NOW).map((row) => row.id)).toEqual(
      ['g-claude'],
    );
    expect(
      filterOauthGrants(rows, { ...base, query: 'chatgpt.com/oauth/client-a' }, NOW).map(
        (row) => row.id,
      ),
    ).toEqual(['g-chatgpt']);
    expect(
      filterOauthGrants(rows, { ...base, query: 'grace@example.com' }, NOW).map((row) => row.id),
    ).toEqual(['g-claude']);
    expect(
      filterOauthGrants(rows, { ...base, query: 'ada lovelace' }, NOW).map((row) => row.id),
    ).toEqual(['g-chatgpt']);
  });

  it('filters by derived client and status', () => {
    const base = defaultOauthGrantListQuery();
    expect(oauthClientOptions(rows)).toEqual(['ChatGPT', 'Claude']);
    expect(
      filterOauthGrants(rows, { ...base, client: 'ChatGPT' }, NOW).map((row) => row.id),
    ).toEqual(['g-chatgpt', 'g-revoked']);
    expect(
      filterOauthGrants(rows, { ...base, status: 'expired' }, NOW).map((row) => row.id),
    ).toEqual(['g-claude']);
    expect(
      filterOauthGrants(rows, { ...base, status: 'revoked' }, NOW).map((row) => row.id),
    ).toEqual(['g-revoked']);
    expect(
      filterOauthGrants(rows, { ...base, status: 'active', client: 'ChatGPT' }, NOW).map(
        (row) => row.id,
      ),
    ).toEqual(['g-chatgpt']);
  });

  it('sorts last used first by default and can sort by created', () => {
    expect(filterOauthGrants(rows, defaultOauthGrantListQuery(), NOW).map((row) => row.id)).toEqual(
      ['g-chatgpt', 'g-revoked', 'g-claude'],
    );
    expect(
      filterOauthGrants(rows, { ...defaultOauthGrantListQuery(), sort: 'created' }, NOW).map(
        (row) => row.id,
      ),
    ).toEqual(['g-claude', 'g-chatgpt', 'g-revoked']);
  });

  it('treats the default query as clear', () => {
    expect(oauthGrantFiltersActive(defaultOauthGrantListQuery())).toBe(false);
    expect(oauthGrantFiltersActive({ ...defaultOauthGrantListQuery(), status: 'expired' })).toBe(
      true,
    );
  });
});
