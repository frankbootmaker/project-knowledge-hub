'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Badge,
  Button,
  ErrorText,
  Field,
  Input,
  Panel,
  Select,
  Switch,
} from '../ui';

type Org = { id: string; name: string; slug: string };
type Workspace = { id: string; name: string; slug: string; organizationId: string };
type User = { id: string; email: string; displayName: string };

type PreflightEndpoints = {
  apiUrl: string;
  webUrl: string;
  mcpUrl: string;
  mcpUrlInternal: string;
  mcpUrlDefault: string;
  mcpUrlOverride: string | null;
  mcpUrlEnv: string | null;
  mcpUrlSource: 'override' | 'env' | 'api_url';
};

type Preflight = {
  health: { ok: boolean; statusCode: number };
  ready: { ok: boolean; statusCode: number; body?: { checks?: Record<string, string> } };
  endpoints: PreflightEndpoints;
};

type TestStep = {
  id: string;
  ok: boolean;
  skipped?: boolean;
  message: string;
};

const READ_SCOPES = [
  'projects:read',
  'systems:read',
  'knowledge:read',
  'knowledge:search',
  'provenance:read',
] as const;

const WRITE_SCOPES = [...READ_SCOPES, 'knowledge:write'] as const;

const steps = ['preflight', 'configure', 'create', 'test', 'cursor'] as const;
type Step = (typeof steps)[number];

export function McpSetupWizard({
  organizations,
  workspaces,
  users,
}: {
  organizations: Org[];
  workspaces: Workspace[];
  users: User[];
}) {
  const t = useTranslations('admin');
  const tCommon = useTranslations('common');

  const [step, setStep] = useState<Step>('preflight');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const [preflight, setPreflight] = useState<Preflight | null>(null);
  const [preflightError, setPreflightError] = useState<string | null>(null);
  const [publicUrlDraft, setPublicUrlDraft] = useState('');
  const [urlSaveMessage, setUrlSaveMessage] = useState<string | null>(null);
  const [showPublicUrlOverride, setShowPublicUrlOverride] = useState(false);

  const [mode, setMode] = useState<'read' | 'write'>('read');
  const [name, setName] = useState('Cursor local');
  const [organizationId, setOrganizationId] = useState(organizations[0]?.id ?? '');
  const [workspaceId, setWorkspaceId] = useState('');
  const [actingUserId, setActingUserId] = useState(users[0]?.id ?? '');

  const [token, setToken] = useState<string | null>(null);
  const [clientName, setClientName] = useState<string | null>(null);
  const [testSteps, setTestSteps] = useState<TestStep[]>([]);
  const [testOk, setTestOk] = useState<boolean | null>(null);
  const [toolNames, setToolNames] = useState<string[]>([]);
  const [copied, setCopied] = useState<'token' | 'config' | null>(null);

  const orgWorkspaces = useMemo(
    () => workspaces.filter((workspace) => workspace.organizationId === organizationId),
    [workspaces, organizationId],
  );

  useEffect(() => {
    if (!workspaceId && orgWorkspaces[0]) {
      setWorkspaceId(orgWorkspaces[0].id);
    }
  }, [orgWorkspaces, workspaceId]);

  async function runPreflight() {
    setPending(true);
    setPreflightError(null);
    try {
      const response = await fetch('/api/v1/mcp/setup/preflight', {
        credentials: 'include',
      });
      const payload = (await response.json()) as Preflight & {
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? t('failed'));
      }
      setPreflight(payload);
      setPublicUrlDraft(payload.endpoints.mcpUrlOverride ?? '');
      setShowPublicUrlOverride(Boolean(payload.endpoints.mcpUrlOverride));
      setUrlSaveMessage(null);
    } catch (err) {
      setPreflightError(err instanceof Error ? err.message : t('failed'));
    } finally {
      setPending(false);
    }
  }

  useEffect(() => {
    void runPreflight();
  }, []);

  async function savePublicUrl(next: string | null) {
    setPending(true);
    setError(null);
    setUrlSaveMessage(null);
    try {
      const response = await fetch('/api/v1/mcp/setup/public-url', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: next && next.trim() ? next.trim() : null }),
      });
      const payload = (await response.json()) as {
        endpoints?: PreflightEndpoints;
        error?: { message?: string };
      };
      if (!response.ok || !payload.endpoints) {
        throw new Error(payload.error?.message ?? t('failed'));
      }
      setPreflight((current) =>
        current
          ? { ...current, endpoints: payload.endpoints as PreflightEndpoints }
          : current,
      );
      setPublicUrlDraft(payload.endpoints.mcpUrlOverride ?? '');
      if (payload.endpoints.mcpUrlOverride) {
        setShowPublicUrlOverride(true);
      }
      setUrlSaveMessage(
        payload.endpoints.mcpUrlOverride
          ? t('mcpWizardPublicUrlSaved')
          : t('mcpWizardPublicUrlReset'),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : t('failed'));
    } finally {
      setPending(false);
    }
  }

  async function createClient() {
    setPending(true);
    setError(null);
    try {
      if (!organizationId || !workspaceId || !name.trim()) {
        throw new Error(t('mcpWizardMissingFields'));
      }
      if (mode === 'write' && !actingUserId) {
        throw new Error(t('mcpWizardActingUserRequired'));
      }

      const response = await fetch('/api/v1/api-clients', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organizationId,
          name: name.trim(),
          scopes: mode === 'write' ? [...WRITE_SCOPES] : [...READ_SCOPES],
          allowedWorkspaceIds: [workspaceId],
          actingUserId: mode === 'write' ? actingUserId : null,
        }),
      });
      const payload = (await response.json()) as {
        token?: string;
        apiClient?: { name?: string };
        error?: { message?: string };
      };
      if (!response.ok || !payload.token) {
        throw new Error(payload.error?.message ?? t('failed'));
      }
      setToken(payload.token);
      setClientName(payload.apiClient?.name ?? name.trim());
      setStep('create');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('failed'));
    } finally {
      setPending(false);
    }
  }

  async function runTests() {
    if (!token) return;
    setPending(true);
    setError(null);
    setTestOk(null);
    try {
      const response = await fetch('/api/v1/mcp/setup/test', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          workspaceId: workspaceId || undefined,
          runSearch: Boolean(workspaceId),
        }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        steps?: TestStep[];
        toolNames?: string[];
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? t('failed'));
      }
      setTestSteps(payload.steps ?? []);
      setTestOk(Boolean(payload.ok));
      setToolNames(payload.toolNames ?? []);
      setStep('test');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('failed'));
    } finally {
      setPending(false);
    }
  }

  const mcpUrl = preflight?.endpoints.mcpUrl ?? 'http://localhost:3101/mcp';
  const cursorConfig = token
    ? JSON.stringify(
        {
          mcpServers: {
            'project-knowledge-hub': {
              url: mcpUrl,
              headers: {
                Authorization: `Bearer ${token}`,
              },
            },
          },
        },
        null,
        2,
      )
    : '';

  async function copyText(value: string, kind: 'token' | 'config') {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      setError(t('mcpWizardCopyFailed'));
    }
  }

  const stepIndex = steps.indexOf(step);
  const preflightOk = Boolean(preflight?.health.ok && preflight.ready.ok);

  return (
    <div className="grid gap-6">
      <ol className="m-0 flex list-none flex-wrap gap-2 p-0">
        {steps.map((item, index) => {
          const active = item === step;
          const done = index < stepIndex;
          return (
            <li key={item}>
              <button
                type="button"
                disabled={
                  (item === 'create' && !token) ||
                  (item === 'test' && !token) ||
                  (item === 'cursor' && !token) ||
                  (item === 'configure' && !preflightOk)
                }
                onClick={() => setStep(item)}
                className={[
                  'rounded-md border px-3 py-1.5 text-sm font-medium transition',
                  active
                    ? 'border-brand bg-brand text-white dark:text-[#0f161d]'
                    : done
                      ? 'border-accent/30 bg-accent-soft text-accent'
                      : 'border-line bg-panel-solid text-ink-muted',
                ].join(' ')}
              >
                {index + 1}. {t(`mcpWizardStep_${item}`)}
              </button>
            </li>
          );
        })}
      </ol>

      {step === 'preflight' ? (
        <Panel className="grid gap-4">
          <div>
            <h2 className="mt-0 mb-1 text-lg font-semibold">{t('mcpWizardPreflightTitle')}</h2>
            <p className="m-0 text-sm text-ink-muted">{t('mcpWizardPreflightBlurb')}</p>
          </div>
          {preflightError ? <ErrorText>{preflightError}</ErrorText> : null}
          {preflight ? (
            <div className="grid gap-3">
              <StatusRow
                ok={preflight.health.ok}
                label={t('mcpWizardHealth')}
                detail={preflight.health.ok ? 'ok' : `HTTP ${preflight.health.statusCode}`}
              />
              <StatusRow
                ok={preflight.ready.ok}
                label={t('mcpWizardReady')}
                detail={
                  preflight.ready.ok
                    ? 'ok'
                    : Object.entries(preflight.ready.body?.checks ?? {})
                        .map(([key, value]) => `${key}: ${value}`)
                        .join(', ') || `HTTP ${preflight.ready.statusCode}`
                }
              />
              <div className="grid gap-3 rounded-md border border-line bg-panel-solid px-3 py-3">
                <p className="m-0 text-sm">
                  <span className="text-ink-muted">{t('mcpWizardInternalUrl')}: </span>
                  <code className="font-mono text-xs">
                    {preflight.endpoints.mcpUrlInternal}
                  </code>
                </p>
                <p className="m-0 text-sm">
                  <span className="text-ink-muted">{t('mcpWizardPublicUrlEffective')}: </span>
                  <code className="font-mono text-xs">{preflight.endpoints.mcpUrl}</code>
                  <Badge className="ml-2" tone="brand">
                    {preflight.endpoints.mcpUrlSource}
                  </Badge>
                </p>
                {preflight.endpoints.mcpUrlEnv ? (
                  <p className="m-0 text-xs text-ink-muted">
                    {t('mcpWizardEnvUrl')}:{' '}
                    <code className="font-mono">{preflight.endpoints.mcpUrlEnv}</code>
                  </p>
                ) : null}
                <Switch
                  id="mcp-public-url-override"
                  checked={showPublicUrlOverride}
                  onCheckedChange={setShowPublicUrlOverride}
                  label={t('mcpWizardPublicUrlToggle')}
                />
              </div>
              {showPublicUrlOverride ? (
                <div className="grid gap-3 rounded-md border border-line bg-panel-solid px-3 py-3">
                  <Field label={t('mcpWizardPublicUrlOverride')}>
                    <Input
                      value={publicUrlDraft}
                      onChange={(e) => setPublicUrlDraft(e.target.value)}
                      placeholder={preflight.endpoints.mcpUrlDefault}
                    />
                  </Field>
                  <p className="m-0 text-xs text-ink-muted">{t('mcpWizardPublicUrlHint')}</p>
                  {urlSaveMessage ? (
                    <p className="m-0 text-sm text-accent">{urlSaveMessage}</p>
                  ) : null}
                  {error && step === 'preflight' ? <ErrorText>{error}</ErrorText> : null}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={pending}
                      onClick={() => void savePublicUrl(publicUrlDraft)}
                    >
                      {t('mcpWizardSavePublicUrl')}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={pending || !preflight.endpoints.mcpUrlOverride}
                      onClick={() => void savePublicUrl(null)}
                    >
                      {t('mcpWizardResetPublicUrl')}
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" disabled={pending} onClick={() => void runPreflight()}>
              {t('mcpWizardRecheck')}
            </Button>
            <Button
              type="button"
              disabled={pending || !preflightOk}
              onClick={() => setStep('configure')}
            >
              {t('mcpWizardContinue')}
            </Button>
          </div>
        </Panel>
      ) : null}

      {step === 'configure' ? (
        <Panel className="grid gap-4">
          <div>
            <h2 className="mt-0 mb-1 text-lg font-semibold">{t('mcpWizardConfigureTitle')}</h2>
            <p className="m-0 text-sm text-ink-muted">{t('mcpWizardConfigureBlurb')}</p>
          </div>
          <Field label={tCommon('name')}>
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <Field label={t('mcpWizardAccessMode')}>
            <Select
              value={mode}
              onChange={(e) => setMode(e.target.value === 'write' ? 'write' : 'read')}
            >
              <option value="read">{t('mcpWizardModeRead')}</option>
              <option value="write">{t('mcpWizardModeWrite')}</option>
            </Select>
          </Field>
          {mode === 'write' ? (
            <p className="m-0 text-xs text-ink-muted">{t('writeScopeHint')}</p>
          ) : null}
          <Field label={t('organization')}>
            <Select
              value={organizationId}
              onChange={(e) => {
                setOrganizationId(e.target.value);
                setWorkspaceId('');
              }}
            >
              {organizations.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('workspace')}>
            <Select value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)}>
              {orgWorkspaces.length === 0 ? (
                <option value="">{tCommon('none')}</option>
              ) : (
                orgWorkspaces.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>
                    {workspace.name}
                  </option>
                ))
              )}
            </Select>
          </Field>
          {mode === 'write' ? (
            <Field label={t('actingUser')}>
              <Select value={actingUserId} onChange={(e) => setActingUserId(e.target.value)}>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.displayName} ({user.email})
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          {error ? <ErrorText>{error}</ErrorText> : null}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={() => setStep('preflight')}>
              {t('mcpWizardBack')}
            </Button>
            <Button
              type="button"
              disabled={pending || !name.trim() || !workspaceId}
              onClick={() => void createClient()}
            >
              {t('mcpWizardCreateClient')}
            </Button>
          </div>
        </Panel>
      ) : null}

      {step === 'create' && token ? (
        <Panel className="grid gap-4">
          <div>
            <h2 className="mt-0 mb-1 text-lg font-semibold">{t('mcpWizardCreateTitle')}</h2>
            <p className="m-0 text-sm text-ink-muted">{t('tokenOnce')}</p>
          </div>
          <p className="m-0 text-sm">
            {t('mcpWizardClientCreated', { name: clientName ?? name })}
          </p>
          <code className="block break-all rounded-md bg-panel-solid px-3 py-2 font-mono text-sm">
            {token}
          </code>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => void copyText(token, 'token')}
            >
              {copied === 'token' ? t('mcpWizardCopied') : t('mcpWizardCopyToken')}
            </Button>
            <Button type="button" disabled={pending} onClick={() => void runTests()}>
              {t('mcpWizardRunTests')}
            </Button>
          </div>
        </Panel>
      ) : null}

      {step === 'test' ? (
        <Panel className="grid gap-4">
          <div>
            <h2 className="mt-0 mb-1 text-lg font-semibold">{t('mcpWizardTestTitle')}</h2>
            <p className="m-0 text-sm text-ink-muted">{t('mcpWizardTestBlurb')}</p>
          </div>
          {error ? <ErrorText>{error}</ErrorText> : null}
          <div className="grid gap-2">
            {testSteps.map((item) => (
              <StatusRow
                key={item.id}
                ok={item.ok}
                skipped={item.skipped}
                label={item.id}
                detail={item.message}
              />
            ))}
          </div>
          {toolNames.length > 0 ? (
            <p className="m-0 text-xs text-ink-muted">
              {t('mcpWizardTools')}: {toolNames.join(', ')}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" disabled={pending} onClick={() => void runTests()}>
              {t('mcpWizardRetest')}
            </Button>
            <Button
              type="button"
              disabled={pending || testOk !== true}
              onClick={() => setStep('cursor')}
            >
              {t('mcpWizardContinue')}
            </Button>
          </div>
        </Panel>
      ) : null}

      {step === 'cursor' && token ? (
        <Panel className="grid gap-4">
          <div>
            <h2 className="mt-0 mb-1 text-lg font-semibold">{t('mcpWizardCursorTitle')}</h2>
            <p className="m-0 text-sm text-ink-muted">{t('mcpWizardCursorBlurb')}</p>
          </div>
          <pre className="m-0 overflow-x-auto rounded-md bg-panel-solid px-3 py-3 font-mono text-xs">
            {cursorConfig}
          </pre>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={() => void copyText(cursorConfig, 'config')}
            >
              {copied === 'config' ? t('mcpWizardCopied') : t('mcpWizardCopyConfig')}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setStep('test')}>
              {t('mcpWizardBack')}
            </Button>
          </div>
          <ul className="m-0 grid list-disc gap-1 pl-5 text-sm text-ink-muted">
            <li>{t('mcpWizardCursorHint1')}</li>
            <li>{t('mcpWizardCursorHint2')}</li>
            <li>{t('mcpWizardCursorHint3')}</li>
          </ul>
        </Panel>
      ) : null}
    </div>
  );
}

function StatusRow({
  ok,
  skipped,
  label,
  detail,
}: {
  ok: boolean;
  skipped?: boolean;
  label: string;
  detail: string;
}) {
  const tone = skipped ? 'neutral' : ok ? 'success' : 'danger';
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-line bg-panel-solid px-3 py-2">
      <div>
        <p className="m-0 text-sm font-medium">{label}</p>
        <p className="mt-1 mb-0 text-xs text-ink-muted">{detail}</p>
      </div>
      <Badge tone={tone}>{skipped ? 'skipped' : ok ? 'ok' : 'fail'}</Badge>
    </div>
  );
}
