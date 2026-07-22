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
  useToast,
} from '../ui';
import {
  defaultClientName,
  LlmClientPicker,
  McpClientSchemas,
  type LlmClientId,
} from './McpClientSchemas';
import { McpConnectionTroubleshoot } from '../mcp-setup/McpConnectionTroubleshoot';
import { McpSetupDonePanel } from '../mcp-setup/McpSetupDonePanel';
import { McpSetupStatusRow } from '../mcp-setup/McpSetupStatusRow';
import { MCP_SETUP_STEPS, type McpSetupStep } from '../mcp-setup/scopes';

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
  mcpUrlSource: 'override' | 'env' | 'web_url' | 'api_url';
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
  const { pushToast } = useToast();

  const [step, setStep] = useState<McpSetupStep>('preflight');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const [preflight, setPreflight] = useState<Preflight | null>(null);
  const [preflightError, setPreflightError] = useState<string | null>(null);
  const [publicUrlDraft, setPublicUrlDraft] = useState('');
  const [urlSaveMessage, setUrlSaveMessage] = useState<string | null>(null);
  const [showPublicUrlOverride, setShowPublicUrlOverride] = useState(false);

  const [llmClient, setLlmClient] = useState<LlmClientId>('cursor');
  const [mode, setMode] = useState<'read' | 'write'>('read');
  const [name, setName] = useState(defaultClientName('cursor'));
  const [organizationId, setOrganizationId] = useState(organizations[0]?.id ?? '');
  const [workspaceId, setWorkspaceId] = useState('');
  const [actingUserId, setActingUserId] = useState(users[0]?.id ?? '');

  function selectLlmClient(next: LlmClientId) {
    setLlmClient(next);
    setName((current) => {
      const previousDefault = defaultClientName(llmClient);
      return !current.trim() || current === previousDefault
        ? defaultClientName(next)
        : current;
    });
  }

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
      const saved = Boolean(payload.endpoints.mcpUrlOverride);
      setUrlSaveMessage(
        saved ? t('mcpWizardPublicUrlSaved') : t('mcpWizardPublicUrlReset'),
      );
      pushToast(saved ? t('toastMcpPublicUrlSaved') : t('toastMcpPublicUrlReset'));
    } catch (err) {
      const message = err instanceof Error ? err.message : t('failed');
      setError(message);
      pushToast(message, 'danger');
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
      const issuedName = payload.apiClient?.name ?? name.trim();
      setToken(payload.token);
      setClientName(issuedName);
      pushToast(t('toastMcpClientCreated', { name: issuedName }));
      setStep('create');
    } catch (err) {
      const message = err instanceof Error ? err.message : t('failed');
      setError(message);
      pushToast(message, 'danger');
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
      const ok = Boolean(payload.ok);
      setTestSteps(payload.steps ?? []);
      setTestOk(ok);
      setToolNames(payload.toolNames ?? []);
      pushToast(ok ? t('toastMcpTestsPassed') : t('toastMcpTestsFailed'), ok ? 'success' : 'danger');
      setStep('test');
    } catch (err) {
      const message = err instanceof Error ? err.message : t('failed');
      setError(message);
      pushToast(message, 'danger');
    } finally {
      setPending(false);
    }
  }

  const mcpUrl = preflight?.endpoints.mcpUrl ?? 'http://localhost:3101/mcp';

  async function copyText(value: string, kind: 'token' | 'config') {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      pushToast(t('toastCopied'));
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      setError(t('mcpWizardCopyFailed'));
      pushToast(t('mcpWizardCopyFailed'), 'danger');
    }
  }

  function finishSetup() {
    setStep('done');
    pushToast(t('toastMcpSetupFinished'));
  }

  function startAnother() {
    setStep('preflight');
    setError(null);
    setToken(null);
    setClientName(null);
    setTestSteps([]);
    setTestOk(null);
    setToolNames([]);
    setCopied(null);
    setMode('read');
    setLlmClient('cursor');
    setName(defaultClientName('cursor'));
    setOrganizationId(organizations[0]?.id ?? '');
    setWorkspaceId('');
    setActingUserId(users[0]?.id ?? '');
    void runPreflight();
  }

  const stepIndex = MCP_SETUP_STEPS.indexOf(step);
  const preflightOk = Boolean(preflight?.health.ok && preflight.ready.ok);

  return (
    <div className="grid gap-6">
      <ol className="m-0 flex list-none flex-wrap gap-2 p-0">
        {MCP_SETUP_STEPS.map((item, index) => {
          const active = item === step;
          const done = index < stepIndex;
          return (
            <li key={item}>
              <button
                type="button"
                disabled={
                  (item === 'create' && !token) ||
                  (item === 'test' && !token) ||
                  (item === 'schema' && !token) ||
                  (item === 'done' && !token) ||
                  (item === 'configure' && !preflightOk)
                }
                onClick={() => setStep(item)}
                className={[
                  'kh-step',
                  active ? 'kh-step-active' : done ? 'kh-step-done' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
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
              <McpSetupStatusRow
                ok={preflight.health.ok}
                label={t('mcpWizardHealth')}
                detail={preflight.health.ok ? 'ok' : `HTTP ${preflight.health.statusCode}`}
              />
              <McpSetupStatusRow
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
              <Panel variant="inset" className="grid gap-3">
                <p className="m-0 text-sm">
                  <span className="text-ink-muted">{t('mcpWizardInternalUrl')}: </span>
                  <code className="font-mono text-xs">
                    {preflight.endpoints.mcpUrlInternal}
                  </code>
                </p>
                <p className="m-0 flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-ink-muted">{t('mcpWizardPublicUrlEffective')}:</span>
                  <code className="font-mono text-xs">{preflight.endpoints.mcpUrl}</code>
                  <Badge tone="brand">{preflight.endpoints.mcpUrlSource}</Badge>
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
              </Panel>
              {showPublicUrlOverride ? (
                <Panel variant="inset" className="grid gap-3">
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
                </Panel>
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
          <LlmClientPicker value={llmClient} onChange={selectLlmClient} />
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
            <Button type="button" variant="secondary" onClick={() => setStep('schema')}>
              {t('mcpWizardSkipToSchema')}
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
              <McpSetupStatusRow
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
              disabled={pending || !token}
              onClick={() => setStep('schema')}
            >
              {testOk === true ? t('mcpWizardContinue') : t('mcpWizardSkipToSchema')}
            </Button>
          </div>
          {testOk === false ? (
            <McpConnectionTroubleshoot variant="admin" mcpUrl={mcpUrl} defaultOpen />
          ) : null}
        </Panel>
      ) : null}

      {step === 'schema' && token ? (
        <Panel className="grid gap-4">
          <McpClientSchemas
            client={llmClient}
            mcpUrl={mcpUrl}
            token={token}
            includeWriteTools={mode === 'write'}
            onBack={() => setStep(testSteps.length > 0 ? 'test' : 'create')}
            onFinish={finishSetup}
            onChangeClient={selectLlmClient}
          />
          <McpConnectionTroubleshoot variant="admin" mcpUrl={mcpUrl} />
        </Panel>
      ) : null}

      {step === 'done' ? (
        <McpSetupDonePanel
          variant="admin"
          clientName={clientName}
          mcpUrl={mcpUrl}
          onStartAnother={startAnother}
        />
      ) : null}
    </div>
  );
}
