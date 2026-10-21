import { describe, expect, it } from 'vitest';
import {
  apiClientFiltersActive,
  apiClientListStatus,
  defaultApiClientListQuery,
  filterApiClients,
  type ApiClientListFields,
  type ActingUserLookup,
} from './api-client-list';

const NOW = Date.parse('2026-10-21T12:00:00.000Z');

const users: ActingUserLookup[] = [
  { id: 'user-ada', email: 'ada@example.com', displayName: 'Ada Lovelace' },
  { id: 'user-grace', email: 'grace@example.com', displayName: 'Grace Hopper' },
];

function client(
  overrides: Partial<ApiClientListFields> & Pick<ApiClientListFields, 'id'>,
): ApiClientListFields {
  return {
    name: overrides.id,
    scopes: ['projects:read'],
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('apiClientListStatus', () => {
  it('derives expired from expiresAt and leaves a future or empty expiry active', () => {
    expect(
      apiClientListStatus({ status: 'active', expiresAt: '2026-10-21T12:00:00.000Z' }, NOW),
    ).toBe('expired');
    expect(
      apiClientListStatus({ status: 'active', expiresAt: '2026-10-21T12:00:00.001Z' }, NOW),
    ).toBe('active');
    expect(apiClientListStatus({ status: 'active', expiresAt: null }, NOW)).toBe('active');
    expect(apiClientListStatus({ status: 'active', expiresAt: 'not-a-date' }, NOW)).toBe('active');
  });

  it('lets revoked, pending, and rejected win over a past expiry', () => {
    const past = '2020-01-01T00:00:00.000Z';
    expect(apiClientListStatus({ status: 'active', revokedAt: past, expiresAt: past }, NOW)).toBe(
      'revoked',
    );
    expect(apiClientListStatus({ status: 'revoked', expiresAt: past }, NOW)).toBe('revoked');
    expect(apiClientListStatus({ status: 'pending_approval', expiresAt: past }, NOW)).toBe(
      'pending_approval',
    );
    expect(apiClientListStatus({ status: 'rejected', expiresAt: past }, NOW)).toBe('rejected');
  });
});

describe('filterApiClients', () => {
  const rows = [
    client({
      id: '11111111-1111-1111-1111-111111111111',
      name: 'Cursor desktop',
      tokenPrefix: 'kh_live_abcd',
      description: 'local agent',
      actingUserId: 'user-ada',
      scopes: ['projects:read', 'knowledge:write'],
      status: 'active',
      createdAt: '2026-03-01T00:00:00.000Z',
      lastUsedAt: '2026-10-01T00:00:00.000Z',
    }),
    client({
      id: '22222222-2222-2222-2222-222222222222',
      name: 'Waiting agent',
      tokenPrefix: 'kh_wait_0001',
      status: 'pending_approval',
      scopes: ['projects:read'],
      createdAt: '2026-08-01T00:00:00.000Z',
      lastUsedAt: null,
    }),
    client({
      id: '33333333-3333-3333-3333-333333333333',
      name: 'Old token',
      tokenPrefix: 'kh_old_9999',
      status: 'active',
      expiresAt: '2026-01-01T00:00:00.000Z',
      scopes: ['knowledge:search'],
      actingUserId: 'user-grace',
      createdAt: '2026-01-15T00:00:00.000Z',
      lastUsedAt: '2026-02-01T00:00:00.000Z',
    }),
    client({
      id: '44444444-4444-4444-4444-444444444444',
      name: 'Pulled token',
      tokenPrefix: 'kh_rev_0001',
      status: 'active',
      revokedAt: '2026-09-01T00:00:00.000Z',
      scopes: ['projects:read'],
      createdAt: '2026-05-01T00:00:00.000Z',
      lastUsedAt: '2026-07-01T00:00:00.000Z',
    }),
  ];

  it('searches name, client id, token prefix, and acting user', () => {
    const base = defaultApiClientListQuery();
    expect(
      filterApiClients(rows, users, { ...base, query: 'cursor' }, NOW).map((row) => row.id),
    ).toEqual([rows[0]!.id]);
    expect(
      filterApiClients(rows, users, { ...base, query: '11111111-1111' }, NOW).map(
        (row) => row.name,
      ),
    ).toEqual(['Cursor desktop']);
    expect(
      filterApiClients(rows, users, { ...base, query: 'kh_old_9999' }, NOW).map((row) => row.name),
    ).toEqual(['Old token']);
    expect(
      filterApiClients(rows, users, { ...base, query: 'ada lovelace' }, NOW).map((row) => row.name),
    ).toEqual(['Cursor desktop']);
    expect(
      filterApiClients(rows, users, { ...base, query: 'grace@example.com' }, NOW).map(
        (row) => row.name,
      ),
    ).toEqual(['Old token']);
  });

  it('filters status, including derived expired, and scope', () => {
    const base = defaultApiClientListQuery();
    expect(
      filterApiClients(rows, users, { ...base, status: 'expired' }, NOW).map((row) => row.name),
    ).toEqual(['Old token']);
    expect(
      filterApiClients(rows, users, { ...base, status: 'active' }, NOW).map((row) => row.name),
    ).toEqual(['Cursor desktop']);
    expect(
      filterApiClients(rows, users, { ...base, status: 'revoked' }, NOW).map((row) => row.name),
    ).toEqual(['Pulled token']);
    expect(
      filterApiClients(rows, users, { ...base, status: 'pending_approval' }, NOW).map(
        (row) => row.name,
      ),
    ).toEqual(['Waiting agent']);
    expect(
      filterApiClients(rows, users, { ...base, scope: 'knowledge:search' }, NOW).map(
        (row) => row.name,
      ),
    ).toEqual(['Old token']);
    expect(
      filterApiClients(
        rows,
        users,
        { ...base, status: 'active', scope: 'knowledge:write' },
        NOW,
      ).map((row) => row.name),
    ).toEqual(['Cursor desktop']);
  });

  it('sorts by created and last used, with never-used rows last', () => {
    const base = defaultApiClientListQuery();
    expect(
      filterApiClients(rows, users, { ...base, sort: 'created' }, NOW).map((row) => row.name),
    ).toEqual(['Waiting agent', 'Pulled token', 'Cursor desktop', 'Old token']);
    expect(
      filterApiClients(rows, users, { ...base, sort: 'lastUsed' }, NOW).map((row) => row.name),
    ).toEqual(['Cursor desktop', 'Pulled token', 'Old token', 'Waiting agent']);
  });

  it('treats the default query as clear and a changed sort as active', () => {
    expect(apiClientFiltersActive(defaultApiClientListQuery())).toBe(false);
    expect(apiClientFiltersActive({ ...defaultApiClientListQuery(), sort: 'lastUsed' })).toBe(true);
    expect(apiClientFiltersActive({ ...defaultApiClientListQuery(), query: '  ' })).toBe(false);
  });
});
