'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Badge, Button, ErrorText, Input, Panel, useToast } from '../ui';

export type OauthGrantRow = {
  id: string;
  userId: string;
  userEmail: string | null;
  userDisplayName: string | null;
  organizationId: string;
  clientHost: string;
  scopes: string[];
  allowedWorkspaceIds: string[];
  status: string;
  lastUsedAt: string | null;
  refreshExpiresAt: string | null;
  createdAt: string;
};

function formatWhen(value: string | null, neverLabel: string): string {
  if (!value) return neverLabel;
  return value.slice(0, 16).replace('T', ' ');
}

export function OauthGrantsList({
  grants,
  workspaceNames,
  revokeBase,
  showUser,
  title,
  blurb,
}: {
  grants: OauthGrantRow[];
  workspaceNames: Record<string, string>;
  revokeBase: string;
  showUser: boolean;
  title: string;
  blurb: string;
}) {
  const t = useTranslations('admin');
  const tConnections = useTranslations('aiConnections');
  const router = useRouter();
  const { pushToast } = useToast();
  const [query, setQuery] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return grants;
    return grants.filter((grant) =>
      [
        grant.userDisplayName ?? '',
        grant.userEmail ?? '',
        grant.clientHost,
        grant.scopes.join(' '),
        grant.status,
      ]
        .join(' ')
        .toLowerCase()
        .includes(needle),
    );
  }, [grants, query]);

  async function revoke(grantId: string) {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`${revokeBase}/${grantId}/revoke`, {
        method: 'POST',
        credentials: 'include',
        headers: { Origin: window.location.origin },
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: { message?: string } };
        throw new Error(payload.error?.message ?? tConnections('revokeFailed'));
      }
      pushToast(t('oauthGrantRevoked'));
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : tConnections('revokeFailed');
      setError(message);
      pushToast(message, 'danger');
    } finally {
      setPending(false);
    }
  }

  return (
    <Panel className="grid gap-4 p-4">
      <div>
        <h2 className="m-0 text-base font-semibold">{title}</h2>
        <p className="m-0 mt-1 text-sm text-ink-muted">{blurb}</p>
      </div>
      <Input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t('oauthGrantSearch')}
        aria-label={t('oauthGrantSearch')}
      />
      {error ? <ErrorText>{error}</ErrorText> : null}
      {visible.length === 0 ? (
        <p className="m-0 text-sm text-ink-muted">{t('oauthGrantEmpty')}</p>
      ) : (
        <div className="grid gap-3">
          {visible.map((grant) => (
            <div key={grant.id} className="grid gap-2 border-b border-line pb-3 last:border-0">
              <div className="flex flex-wrap items-center gap-2">
                {showUser ? (
                  <span className="font-medium">
                    {grant.userDisplayName ?? grant.userEmail ?? grant.userId}
                  </span>
                ) : null}
                <Badge tone={grant.status === 'active' ? 'success' : 'neutral'}>
                  {grant.status === 'active' ? t('oauthGrantActive') : t('oauthGrantRevokedStatus')}
                </Badge>
                <span className="text-sm text-ink-muted">{grant.clientHost}</span>
              </div>
              <div className="kh-ops-scope-list kh-ops-scope-list--inline">
                {grant.scopes.map((scope) => (
                  <span key={scope} className="kh-ops-tag">
                    {scope}
                  </span>
                ))}
              </div>
              <p className="m-0 text-sm text-ink-muted">
                {grant.allowedWorkspaceIds
                  .map((id) => workspaceNames[id] ?? id)
                  .join(', ') || t('oauthGrantNoWorkspaces')}
              </p>
              <p className="m-0 text-xs text-ink-muted">
                {t('oauthGrantRefreshExpires')}: {formatWhen(grant.refreshExpiresAt, t('oauthGrantNever'))}
                {' · '}
                {t('oauthGrantLastUsed')}: {formatWhen(grant.lastUsedAt, t('oauthGrantNever'))}
              </p>
              {grant.status === 'active' ? (
                <div>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={pending}
                    onClick={() => void revoke(grant.id)}
                  >
                    {t('oauthGrantRevoke')}
                  </Button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
