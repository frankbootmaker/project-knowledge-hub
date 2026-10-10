'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Badge, Button, ErrorText, Field, Panel, Switch, useToast } from '../ui';

const OAUTH_SCOPES = [
  'projects:read',
  'systems:read',
  'knowledge:read',
  'knowledge:search',
  'provenance:read',
  'knowledge:write',
  'catalogue:write',
  'pm:read',
  'pm:write',
  'monitoring:read',
] as const;

export type OauthMcpSettings = {
  enabled: boolean;
  effectiveEnabled: boolean;
  signingKeyConfigured: boolean;
  signingKeyFingerprint: string | null;
  resourceUrl: string;
  metadataUrl: string;
  redirectUris: string[];
  clientIdPrefixes: string[];
  scopeCeiling: string[];
};

export function OauthResourceCard({ initial }: { initial: OauthMcpSettings | null }) {
  const t = useTranslations('admin');
  const router = useRouter();
  const { pushToast } = useToast();
  const [settings, setSettings] = useState(initial);
  const [enabled, setEnabled] = useState(initial?.enabled ?? false);
  const [redirects, setRedirects] = useState((initial?.redirectUris ?? []).join('\n'));
  const [prefixes, setPrefixes] = useState((initial?.clientIdPrefixes ?? []).join('\n'));
  const [ceiling, setCeiling] = useState<string[]>(initial?.scopeCeiling ?? []);
  const [metadataOk, setMetadataOk] = useState<boolean | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!initial?.metadataUrl) return;
    let cancelled = false;
    void fetch(initial.metadataUrl, { headers: { accept: 'application/json' } })
      .then((response) => {
        if (!cancelled) setMetadataOk(response.ok);
      })
      .catch(() => {
        if (!cancelled) setMetadataOk(false);
      });
    return () => {
      cancelled = true;
    };
  }, [initial?.metadataUrl]);

  if (!settings) {
    return null;
  }

  function toggleScope(scope: string) {
    setCeiling((current) =>
      current.includes(scope) ? current.filter((item) => item !== scope) : [...current, scope],
    );
  }

  async function save() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/v1/admin/oauth-mcp-settings', {
        method: 'PUT',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Origin: window.location.origin,
        },
        body: JSON.stringify({
          enabled,
          redirectUris: redirects.split('\n').map((line) => line.trim()).filter(Boolean),
          clientIdPrefixes: prefixes.split('\n').map((line) => line.trim()).filter(Boolean),
          scopeCeiling: ceiling,
        }),
      });
      const payload = (await response.json()) as OauthMcpSettings & {
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? t('oauthResourceSaveFailed'));
      }
      setSettings(payload);
      setEnabled(payload.enabled);
      pushToast(t('oauthResourceSaved'));
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : t('oauthResourceSaveFailed');
      setError(message);
      pushToast(message, 'danger');
    } finally {
      setPending(false);
    }
  }

  async function copyUrl() {
    if (!settings) return;
    try {
      await navigator.clipboard.writeText(settings.resourceUrl);
      pushToast(t('oauthResourceCopied'));
    } catch {
      pushToast(t('oauthResourceCopyFailed'), 'danger');
    }
  }

  return (
    <Panel className="mb-6 grid gap-4 p-4">
      <div>
        <h2 className="m-0 text-base font-semibold">{t('oauthResourceTitle')}</h2>
        <p className="m-0 mt-1 text-sm text-ink-muted">{t('oauthResourceBlurb')}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <code className="text-sm">{settings.resourceUrl}</code>
        <Button type="button" variant="secondary" onClick={() => void copyUrl()}>
          {t('oauthResourceCopy')}
        </Button>
        <Badge tone={settings.effectiveEnabled ? 'success' : 'neutral'}>
          {settings.effectiveEnabled ? t('oauthResourceLive') : t('oauthResourceOff')}
        </Badge>
      </div>
      <p className="m-0 text-sm">
        {settings.signingKeyConfigured
          ? t('oauthResourceKeyPresent', { fingerprint: settings.signingKeyFingerprint ?? '' })
          : t('oauthResourceKeyMissing')}
      </p>
      <p className="m-0 text-sm">
        {metadataOk === null
          ? t('oauthResourceMetadataChecking')
          : metadataOk
            ? t('oauthResourceMetadataOk')
            : t('oauthResourceMetadataFail')}
      </p>
      <Switch
        checked={enabled}
        onCheckedChange={setEnabled}
        label={t('oauthResourceEnabled')}
        id="oauth-mcp-enabled"
      />
      <Field label={t('oauthRedirects')}>
        <textarea
          className="kh-input min-h-20 w-full"
          value={redirects}
          onChange={(event) => setRedirects(event.target.value)}
        />
      </Field>
      <p className="m-0 text-sm text-ink-muted">{t('oauthRedirectsHint')}</p>
      <Field label={t('oauthClientPrefixes')}>
        <textarea
          className="kh-input min-h-20 w-full"
          value={prefixes}
          onChange={(event) => setPrefixes(event.target.value)}
        />
      </Field>
      <p className="m-0 text-sm text-ink-muted">{t('oauthClientPrefixesHint')}</p>
      <fieldset className="grid gap-2">
        <legend className="text-sm font-medium">{t('oauthScopeCeiling')}</legend>
        <p className="m-0 text-sm text-ink-muted">{t('oauthScopeCeilingHint')}</p>
        <div className="flex flex-wrap gap-3">
          {OAUTH_SCOPES.map((scope) => (
            <label key={scope} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={ceiling.includes(scope)}
                onChange={() => toggleScope(scope)}
              />
              {scope}
            </label>
          ))}
        </div>
      </fieldset>
      {error ? <ErrorText>{error}</ErrorText> : null}
      <div>
        <Button type="button" disabled={pending} onClick={() => void save()}>
          {t('oauthResourceSave')}
        </Button>
      </div>
    </Panel>
  );
}
