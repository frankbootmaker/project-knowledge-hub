import { isTimestampExpired } from './api-client-list';

export const OAUTH_GRANT_STATUS_FILTERS = ['all', 'active', 'revoked', 'expired'] as const;

export type OauthGrantStatusFilter = (typeof OAUTH_GRANT_STATUS_FILTERS)[number];

export const OAUTH_GRANT_SORTS = ['lastUsed', 'created'] as const;

export type OauthGrantSort = (typeof OAUTH_GRANT_SORTS)[number];

export type OauthGrantListStatus = 'active' | 'revoked' | 'expired';

export type OauthGrantListFields = {
  id: string;
  userDisplayName?: string | null;
  userEmail?: string | null;
  clientHost: string;
  clientId?: string | null;
  scopes: readonly string[];
  status?: string | null;
  revokedAt?: string | null;
  refreshExpiresAt?: string | null;
  lastUsedAt?: string | null;
  createdAt: string;
};

export type OauthGrantListQuery = {
  query: string;
  status: OauthGrantStatusFilter;
  client: string;
  sort: OauthGrantSort;
};

export function defaultOauthGrantListQuery(): OauthGrantListQuery {
  return {
    query: '',
    status: 'all',
    client: 'all',
    sort: 'lastUsed',
  };
}

export function oauthGrantFiltersActive(query: OauthGrantListQuery): boolean {
  const defaults = defaultOauthGrantListQuery();
  return (
    query.query.trim() !== defaults.query ||
    query.status !== defaults.status ||
    query.client !== defaults.client ||
    query.sort !== defaults.sort
  );
}

/** Friendly client name from the host. Unknown hosts stay as the host string. */
export function oauthClientLabel(clientHost: string): string {
  const host = clientHost.trim().toLowerCase();
  if (host.includes('chatgpt') || host.includes('openai.com')) return 'ChatGPT';
  if (host.includes('claude')) return 'Claude';
  if (host.includes('codex')) return 'Codex';
  return clientHost.trim() || clientHost;
}

export function oauthClientOptions(grants: readonly { clientHost: string }[]): string[] {
  const labels = new Set(grants.map((grant) => oauthClientLabel(grant.clientHost)));
  return [...labels].sort((left, right) => left.localeCompare(right));
}

/**
 * Revoked wins over a past refresh expiry.
 * Expired is derived from `refreshExpiresAt` (`<= now`).
 */
export function oauthGrantListStatus(
  grant: Pick<OauthGrantListFields, 'status' | 'revokedAt' | 'refreshExpiresAt'>,
  now: number,
): OauthGrantListStatus {
  if (grant.revokedAt || grant.status === 'revoked') return 'revoked';
  if (isTimestampExpired(grant.refreshExpiresAt, now)) return 'expired';
  return 'active';
}

export function filterOauthGrants<T extends OauthGrantListFields>(
  grants: readonly T[],
  query: OauthGrantListQuery,
  now: number,
): T[] {
  const needle = query.query.trim().toLowerCase();
  const matched = grants.filter((grant) => {
    const status = oauthGrantListStatus(grant, now);
    if (query.status !== 'all' && status !== query.status) return false;
    const label = oauthClientLabel(grant.clientHost);
    if (query.client !== 'all' && label !== query.client) return false;
    if (!needle) return true;
    return oauthGrantSearchHaystack(grant, label).includes(needle);
  });
  return [...matched].sort((left, right) => compareGrants(left, right, query.sort));
}

function oauthGrantSearchHaystack(grant: OauthGrantListFields, label: string): string {
  return [
    label,
    grant.clientHost,
    grant.clientId ?? '',
    grant.userDisplayName ?? '',
    grant.userEmail ?? '',
    grant.scopes.join(' '),
    grant.status ?? '',
  ]
    .join(' ')
    .toLowerCase();
}

function timestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function compareDescNullsLast(
  left: string | null | undefined,
  right: string | null | undefined,
  leftTie: string,
  rightTie: string,
): number {
  const a = timestamp(left);
  const b = timestamp(right);
  if (a == null && b == null) return (timestamp(rightTie) ?? 0) - (timestamp(leftTie) ?? 0);
  if (a == null) return 1;
  if (b == null) return -1;
  if (a !== b) return b - a;
  return (timestamp(rightTie) ?? 0) - (timestamp(leftTie) ?? 0);
}

function compareGrants(
  left: OauthGrantListFields,
  right: OauthGrantListFields,
  sort: OauthGrantSort,
): number {
  if (sort === 'created') {
    return compareDescNullsLast(left.createdAt, right.createdAt, left.id, right.id);
  }
  return compareDescNullsLast(left.lastUsedAt, right.lastUsedAt, left.createdAt, right.createdAt);
}
