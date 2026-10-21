export const API_CLIENT_STATUS_FILTERS = [
  'all',
  'active',
  'pending_approval',
  'revoked',
  'expired',
] as const;

export type ApiClientStatusFilter = (typeof API_CLIENT_STATUS_FILTERS)[number];

export const API_CLIENT_SORTS = ['created', 'lastUsed'] as const;

export type ApiClientSort = (typeof API_CLIENT_SORTS)[number];

export type ApiClientListStatus =
  'active' | 'pending_approval' | 'revoked' | 'expired' | 'rejected';

export type ApiClientListFields = {
  id: string;
  name: string;
  description?: string | null;
  tokenPrefix?: string | null;
  agentLabel?: string | null;
  scopes: readonly string[];
  status?: string | null;
  actingUserId?: string | null;
  expiresAt?: string | null;
  revokedAt?: string | null;
  lastUsedAt?: string | null;
  createdAt: string;
};

export type ActingUserLookup = {
  id: string;
  email: string;
  displayName: string;
};

export type ApiClientListQuery = {
  query: string;
  status: ApiClientStatusFilter;
  scope: string;
  sort: ApiClientSort;
};

export function defaultApiClientListQuery(): ApiClientListQuery {
  return {
    query: '',
    status: 'all',
    scope: 'all',
    sort: 'created',
  };
}

export function apiClientFiltersActive(query: ApiClientListQuery): boolean {
  const defaults = defaultApiClientListQuery();
  return (
    query.query.trim() !== defaults.query ||
    query.status !== defaults.status ||
    query.scope !== defaults.scope ||
    query.sort !== defaults.sort
  );
}

/** Expired when `expiresAt <= now`, matching the API validity check (`expiresAt > now`). */
export function isTimestampExpired(value: string | null | undefined, now: number): boolean {
  if (!value) return false;
  const parsed = Date.parse(value);
  return !Number.isNaN(parsed) && parsed <= now;
}

/**
 * Revoked and workflow statuses win over a past `expiresAt`.
 * Expired is derived only for clients that are otherwise active.
 */
export function apiClientListStatus(
  client: Pick<ApiClientListFields, 'status' | 'expiresAt' | 'revokedAt'>,
  now: number,
): ApiClientListStatus {
  if (client.revokedAt || client.status === 'revoked') return 'revoked';
  if (client.status === 'pending_approval') return 'pending_approval';
  if (client.status === 'rejected') return 'rejected';
  if (isTimestampExpired(client.expiresAt, now)) return 'expired';
  return 'active';
}

export function filterApiClients<T extends ApiClientListFields>(
  clients: readonly T[],
  users: readonly ActingUserLookup[],
  query: ApiClientListQuery,
  now: number,
): T[] {
  const needle = query.query.trim().toLowerCase();
  const usersById = new Map(users.map((user) => [user.id, user]));
  const matched = clients.filter((client) => {
    const status = apiClientListStatus(client, now);
    if (query.status !== 'all' && status !== query.status) return false;
    if (query.scope !== 'all' && !client.scopes.includes(query.scope)) return false;
    if (!needle) return true;
    const user = client.actingUserId ? usersById.get(client.actingUserId) : undefined;
    return apiClientSearchHaystack(client, user).includes(needle);
  });
  return [...matched].sort((left, right) => compareApiClients(left, right, query.sort));
}

function apiClientSearchHaystack(
  client: ApiClientListFields,
  user: ActingUserLookup | undefined,
): string {
  return [
    client.name,
    client.id,
    client.tokenPrefix ?? '',
    client.description ?? '',
    client.agentLabel ?? '',
    user?.displayName ?? '',
    user?.email ?? '',
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

function compareApiClients(
  left: ApiClientListFields,
  right: ApiClientListFields,
  sort: ApiClientSort,
): number {
  if (sort === 'lastUsed') {
    return compareDescNullsLast(left.lastUsedAt, right.lastUsedAt, left.createdAt, right.createdAt);
  }
  return compareDescNullsLast(left.createdAt, right.createdAt, left.id, right.id);
}
