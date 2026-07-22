'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  Button,
  ErrorText,
  Field,
  Input,
  Panel,
  Select,
  useToast,
} from '../ui';
import {
  defaultClientName,
  LlmClientPicker,
  McpClientSchemas,
  type LlmClientId,
} from './McpClientSchemas';
import { McpConnectionTroubleshoot } from './McpConnectionTroubleshoot';
import { McpSetupDonePanel } from './McpSetupDonePanel';
import { McpSetupStatusRow } from './McpSetupStatusRow';
import {
  MCP_READ_SCOPES,
  MCP_SETUP_STEPS,
  MCP_WRITE_SCOPES,
  type McpSetupStep,
} from './scopes';

type Workspace = { id: string; name: string; slug: string };

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

export function UserMcpSetupWizard({
  workspaces,
  initialToken,
  initialClientName,
  onTokenIssued,
}: {
  workspaces: Workspace[];
  /** When pairing approve returns a token, jump into schema with it. */
  initialToken?: string | null;
  initialClientName?: string | null;
  onTokenIssued?: () => void;
}) {
  const t = useTranslations('admin');
  const tAi = useTranslations('aiConnections');
  const tCommon = useTranslations('common');
  const { pushToast } = useToast();
  const router = useRouter();

  const [step, setStep] = useState<McpSetupStep>(
    initialToken ? 'schema' : 'preflight',
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const [preflight, setPreflight] = useState<Preflight | null>(null);
  const [preflightError, setPreflightError] = useState<string | null>(null);

  const [llmClient, setLlmClient] = useState<LlmClientId>('cursor');
  const [mode, setMode] = useState<'read' | 'write'>('read');
  const [name, setName] = useState(defaultClientName('cursor'));
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.id ?? '');

  const [token, setToken] = useState<string | null>(initialToken ?? null);
  const [clientName, setClientName] = useState<string | null>(
    initialClientName ?? null,
  );
  const [testSteps, setTestSteps] = useState<TestStep[]>([]);
  const [testOk, setTestOk] = useState<boolean | null>(null);
  const [toolNames, setToolNames] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);

  function selectLlmClient(next: LlmClientId) {
    setLlmClient(next);
    setName((current) => {
      const previousDefault = defaultClientName(llmClient);
      return !current.trim() || current === previousDefault
        ? defaultClientName(next)
        : current;
    });
  }

  useEffect(() => {
    if (!workspaceId && workspaces[0]) {
      setWorkspaceId(workspaces[0].id);
    }
  }, [workspaces, workspaceId]);

  useEffect(() => {
    if (initialToken) {
      setToken(initialToken);
      setClientName(initialClientName ?? null);
      setStep('schema');
    }
  }, [initialToken, initialClientName]);

  async function runPreflight() {
    setPending(true);
    setPreflightError(null);
    try {
      const response = await fetch('/api/v1/me/mcp/setup/preflight', {
        credentials: 'include',
      });
      const payload = (await response.json()) as Preflight & {
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? t('failed'));
      }
      setPreflight(payload);
    } catch (err) {
      setPreflightError(err instanceof Error ? err.message : t('failed'));
    } finally {
      setPending(false);
    }
  }

  useEffect(() => {
    void runPreflight();
  }, []);

  async function createClient() {
    setPending(true);
    setError(null);
    try {
      if (!workspaceId || !name.trim()) {
        throw new Error(t('mcpWizardMissingFields'));
      }

      const response = await fetch('/api/v1/me/api-clients', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          scopes: mode === 'write' ? [...MCP_WRITE_SCOPES] : [...MCP_READ_SCOPES],
          allowedWorkspaceIds: [workspaceId],
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
      onTokenIssued?.();
      router.refresh();
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
      const response = await fetch('/api/v1/me/mcp/setup/test', {
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
      pushToast(
        ok ? t('toastMcpTestsPassed') : t('toastMcpTestsFailed'),
        ok ? 'success' : 'danger',
      );
      setStep('test');
    } catch (err) {
      const message = err instanceof Error ? err.message : t('failed');
      setError(message);
      pushToast(message, 'danger');
    } finally {
      setPending(false);
    }
  }

  const mcpUrl = preflight?.endpoints.mcpUrl ?? 'http://localhost:3100/mcp';
  const stepIndex = MCP_SETUP_STEPS.indexOf(step);
  const preflightOk = Boolean(preflight?.health.ok && preflight.ready.ok);

  async function copyToken() {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      pushToast(t('toastCopied'));
      window.setTimeout(() => setCopied(false), 2000);
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
    setCopied(false);
    setMode('read');
    setLlmClient('cursor');
    setName(defaultClientName('cursor'));
    setWorkspaceId(workspaces[0]?.id ?? '');
    onTokenIssued?.();
    void runPreflight();
  }

  return (
    <div className="grid gap-6">
      <div>
        <h2 className="mt-0 mb-1 text-lg font-semibold">{tAi('wizardTitle')}</h2>
        <p className="m-0 text-sm text-ink-muted">{tAi('wizardBlurb')}</p>
      </div>

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
            <h3 className="mt-0 mb-1 text-base font-semibold">
              {t('mcpWizardPreflightTitle')}
            </h3>
            <p className="m-0 text-sm text-ink-muted">{tAi('wizardPreflightBlurb')}</p>
          </div>
          {preflightError ? <ErrorText>{preflightError}</ErrorText> : null}
          {preflight ? (
            <div className="grid gap-3">
              <McpSetupStatusRow
                ok={preflight.health.ok}
                label={t('mcpWizardHealth')}
                detail={
                  preflight.health.ok ? 'ok' : `HTTP ${preflight.health.statusCode}`
                }
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
              <p className="m-0 flex flex-wrap items-center gap-2 text-sm">
                <span className="text-ink-muted">{t('mcpWizardPublicUrlEffective')}:</span>
                <code className="font-mono text-xs">{preflight.endpoints.mcpUrl}</code>
              </p>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() => void runPreflight()}
            >
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
            <h3 className="mt-0 mb-1 text-base font-semibold">
              {t('mcpWizardConfigureTitle')}
            </h3>
            <p className="m-0 text-sm text-ink-muted">{tAi('wizardConfigureBlurb')}</p>
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
            <p className="m-0 text-xs text-ink-muted">{tAi('wizardWriteHint')}</p>
          ) : null}
          <Field label={t('workspace')}>
            <Select
              value={workspaceId}
              onChange={(e) => setWorkspaceId(e.target.value)}
            >
              {workspaces.length === 0 ? (
                <option value="">{tCommon('none')}</option>
              ) : (
                workspaces.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>
                    {workspace.name}
                  </option>
                ))
              )}
            </Select>
          </Field>
          {error ? <ErrorText>{error}</ErrorText> : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setStep('preflight')}
            >
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
            <h3 className="mt-0 mb-1 text-base font-semibold">
              {t('mcpWizardCreateTitle')}
            </h3>
            <p className="m-0 text-sm text-ink-muted">{t('tokenOnce')}</p>
          </div>
          <p className="m-0 text-sm">
            {t('mcpWizardClientCreated', { name: clientName ?? name })}
          </p>
          <code className="block break-all rounded-md bg-panel-solid px-3 py-2 font-mono text-sm">
            {token}
          </code>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={() => void copyToken()}>
              {copied ? t('mcpWizardCopied') : t('mcpWizardCopyToken')}
            </Button>
            <Button type="button" disabled={pending} onClick={() => void runTests()}>
              {t('mcpWizardRunTests')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setStep('schema')}
            >
              {t('mcpWizardSkipToSchema')}
            </Button>
          </div>
        </Panel>
      ) : null}

      {step === 'test' ? (
        <Panel className="grid gap-4">
          <div>
            <h3 className="mt-0 mb-1 text-base font-semibold">
              {t('mcpWizardTestTitle')}
            </h3>
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
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() => void runTests()}
            >
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
            <McpConnectionTroubleshoot variant="user" mcpUrl={mcpUrl} defaultOpen />
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
          <McpConnectionTroubleshoot variant="user" mcpUrl={mcpUrl} />
        </Panel>
      ) : null}

      {step === 'done' ? (
        <McpSetupDonePanel
          variant="user"
          clientName={clientName}
          mcpUrl={mcpUrl}
          onStartAnother={startAnother}
        />
      ) : null}
    </div>
  );
}
