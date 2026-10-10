'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button, ErrorText, Page, Panel } from '../ui';

type Workspace = { id: string; name: string; slug: string };
type ConsentRequest = {
  txn: string;
  clientHost: string;
  resource: string;
  scopes: string[];
  systemUser: boolean;
};

const WRITE_SCOPES = new Set(['knowledge:write', 'pm:write', 'catalogue:write']);

export function OauthConsentForm() {
  const t = useTranslations('oauthConsent');
  const router = useRouter();
  const searchParams = useSearchParams();
  const txn = searchParams.get('txn') ?? '';
  const [request, setRequest] = useState<ConsentRequest | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [scopes, setScopes] = useState<string[]>([]);
  const [workspaceIds, setWorkspaceIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!txn) {
      setError(t('missingTxn'));
      return;
    }
    let cancelled = false;
    void (async () => {
      const [consentRes, workspaceRes] = await Promise.all([
        fetch(`/api/v1/oauth/consent-request?txn=${encodeURIComponent(txn)}`, {
          credentials: 'include',
        }),
        fetch('/api/v1/workspaces', { credentials: 'include' }),
      ]);
      if (consentRes.status === 401 || workspaceRes.status === 401) {
        const next = `/oauth/consent?txn=${encodeURIComponent(txn)}`;
        router.replace(`/login?next=${encodeURIComponent(next)}`);
        return;
      }
      if (!consentRes.ok) {
        if (!cancelled) setError(t('loadFailed'));
        return;
      }
      const payload = (await consentRes.json()) as ConsentRequest;
      const workspacePayload = workspaceRes.ok
        ? ((await workspaceRes.json()) as { workspaces: Workspace[] })
        : { workspaces: [] };
      if (cancelled) return;
      setRequest(payload);
      setWorkspaces(workspacePayload.workspaces);
      setScopes(payload.scopes.filter((scope) => !WRITE_SCOPES.has(scope)));
      if (payload.systemUser) {
        setError(t('systemUser'));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router, t, txn]);

  function toggle(list: string[], value: string, setter: (next: string[]) => void) {
    setter(list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);
  }

  async function submit() {
    if (!request || request.systemUser) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/v1/oauth/consent', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Origin: window.location.origin,
        },
        body: JSON.stringify({
          txn,
          scopes,
          allowedWorkspaceIds: workspaceIds,
        }),
      });
      const payload = (await response.json()) as {
        redirectTo?: string;
        error?: { message?: string };
      };
      if (!response.ok || !payload.redirectTo) {
        throw new Error(payload.error?.message ?? t('submitFailed'));
      }
      window.location.assign(payload.redirectTo);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('submitFailed'));
      setPending(false);
    }
  }

  return (
    <Page>
      <Panel className="mx-auto grid max-w-xl gap-4 p-6">
        <div>
          <h1 className="m-0 text-xl font-semibold">{t('title')}</h1>
          <p className="m-0 mt-2 text-sm text-ink-muted">{t('blurb')}</p>
        </div>
        {request ? (
          <p className="m-0 text-sm">
            {t('client')}: {request.clientHost}
          </p>
        ) : null}
        <fieldset className="grid gap-2" disabled={request?.systemUser}>
          <legend className="text-sm font-medium">{t('workspaces')}</legend>
          {workspaces.map((workspace) => (
            <label key={workspace.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={workspaceIds.includes(workspace.id)}
                onChange={() => toggle(workspaceIds, workspace.id, setWorkspaceIds)}
              />
              {workspace.name}
            </label>
          ))}
        </fieldset>
        <fieldset className="grid gap-2" disabled={request?.systemUser}>
          <legend className="text-sm font-medium">{t('scopes')}</legend>
          {(request?.scopes ?? []).map((scope) => (
            <label key={scope} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={scopes.includes(scope)}
                onChange={() => toggle(scopes, scope, setScopes)}
              />
              {scope}
            </label>
          ))}
        </fieldset>
        {error ? <ErrorText>{error}</ErrorText> : null}
        <div>
          <Button
            type="button"
            disabled={pending || !request || request.systemUser || scopes.length === 0}
            onClick={() => void submit()}
          >
            {t('submit')}
          </Button>
        </div>
      </Panel>
    </Page>
  );
}
