'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  SYNC_PROVIDER_CATALOG,
  isSyncProviderSupported,
  providerNeedsBaseUrl,
  providerShowsBaseUrl,
  type SyncProvider,
} from '@project-knowledge-hub/domain';
import {
  Badge,
  Button,
  ErrorText,
  Field,
  Input,
  Modal,
  Panel,
  PasswordInput,
  Select,
  Textarea,
} from './ui';

type ProjectOption = { id: string; name: string; slug: string };

type SyncHealthStatus =
  | 'healthy'
  | 'needs_sync'
  | 'never_synced'
  | 'error'
  | 'paused'
  | 'check_failed';

type SyncHealth = {
  status: SyncHealthStatus;
  remoteCommitSha: string | null;
  lastSyncedCommitSha: string | null;
  lastSyncedAt: string | null;
  message: string;
};

type Connection = {
  id: string;
  provider: string;
  owner: string;
  repo: string;
  branch: string;
  baseUrl?: string | null;
  projectId: string | null;
  status: string;
  lastError: string | null;
  lastSyncedAt: string | null;
  lastSyncedCommitSha: string | null;
  accessTokenPreview: string;
  includePaths: string[];
  excludePaths: string[];
  hasWebhookSecret?: boolean;
  syncHealth: SyncHealth | null;
};

type SyncRun = {
  id: string;
  status: string;
  trigger: string;
  commitSha: string | null;
  stats: Record<string, number> | null;
  errorMessage: string | null;
  createdAt: string;
  finishedAt: string | null;
};

function healthTone(status: SyncHealthStatus): 'success' | 'warn' | 'danger' | 'neutral' {
  if (status === 'healthy') return 'success';
  if (status === 'needs_sync' || status === 'never_synced' || status === 'check_failed') {
    return 'warn';
  }
  if (status === 'error') return 'danger';
  return 'neutral';
}

function providerLabelKey(provider: string): `provider_${SyncProvider}` | 'provider_unknown' {
  if (SYNC_PROVIDER_CATALOG.some((entry) => entry.id === provider)) {
    return `provider_${provider as SyncProvider}`;
  }
  return 'provider_unknown';
}

export function GitConnectionsPanel(props: {
  workspaceId: string;
  projects: ProjectOption[];
  initialConnections: Connection[];
  canManage: boolean;
  addOpen?: boolean;
  onAddOpenChange?: (open: boolean) => void;
}) {
  const t = useTranslations('gitSync');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const [connections, setConnections] = useState(props.initialConnections);
  const [runsByConnection, setRunsByConnection] = useState<Record<string, SyncRun[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [addOpenInternal, setAddOpenInternal] = useState(false);
  const addOpen = props.addOpen ?? addOpenInternal;
  function setAddOpen(open: boolean) {
    props.onAddOpenChange?.(open);
    if (props.addOpen === undefined) {
      setAddOpenInternal(open);
    }
  }

  const [addStep, setAddStep] = useState<'provider' | 'form'>('provider');
  const [selectedProvider, setSelectedProvider] = useState<SyncProvider | null>(null);

  const [owner, setOwner] = useState('');
  const [repo, setRepo] = useState('');
  const [branch, setBranch] = useState('main');
  const [baseUrl, setBaseUrl] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [projectId, setProjectId] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [includePaths, setIncludePaths] = useState('docs/**/*.md\nREADME.md\n**/ADR-*.md');

  const [manageConnectionId, setManageConnectionId] = useState<string | null>(null);
  const [manageBranch, setManageBranch] = useState('');
  const [manageBaseUrl, setManageBaseUrl] = useState('');
  const [manageToken, setManageToken] = useState('');
  const [manageWebhook, setManageWebhook] = useState('');
  const [manageStatus, setManageStatus] = useState<'active' | 'paused'>('active');
  const [manageIncludePaths, setManageIncludePaths] = useState('');
  const [manageProjectId, setManageProjectId] = useState('');
  const [manageError, setManageError] = useState<string | null>(null);

  useEffect(() => {
    setConnections(props.initialConnections);
  }, [props.initialConnections]);

  useEffect(() => {
    if (addOpen) {
      setAddStep('provider');
      setSelectedProvider(null);
      setError(null);
    }
  }, [addOpen]);

  const includePathList = useMemo(
    () =>
      includePaths
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
    [includePaths],
  );

  const manageConnection =
    connections.find((connection) => connection.id === manageConnectionId) ?? null;

  function resetAddForm() {
    setAddStep('provider');
    setSelectedProvider(null);
    setOwner('');
    setRepo('');
    setBranch('main');
    setBaseUrl('');
    setAccessToken('');
    setProjectId('');
    setWebhookSecret('');
    setIncludePaths('docs/**/*.md\nREADME.md\n**/ADR-*.md');
    setError(null);
  }

  function openAdd() {
    resetAddForm();
    setAddOpen(true);
  }

  function closeAdd() {
    setAddOpen(false);
    resetAddForm();
  }

  function openManage(connection: Connection) {
    setManageConnectionId(connection.id);
    setManageBranch(connection.branch);
    setManageBaseUrl(connection.baseUrl ?? '');
    setManageToken('');
    setManageWebhook('');
    setManageStatus(connection.status === 'paused' ? 'paused' : 'active');
    setManageIncludePaths(connection.includePaths.join('\n'));
    setManageProjectId(connection.projectId ?? '');
    setManageError(null);
    void loadRuns(connection.id);
  }

  function closeManage() {
    setManageConnectionId(null);
    setManageError(null);
  }

  async function refreshConnections() {
    const response = await fetch(
      `/api/v1/workspaces/${props.workspaceId}/git-connections?checkRemote=true`,
      { credentials: 'include' },
    );
    if (!response.ok) return;
    const payload = (await response.json()) as { connections: Connection[] };
    setConnections(payload.connections);
  }

  async function createConnection() {
    if (!selectedProvider || !isSyncProviderSupported(selectedProvider)) {
      setError(t('providerComingSoon'));
      return;
    }
    if (providerNeedsBaseUrl(selectedProvider) && !baseUrl.trim()) {
      setError(t('baseUrlRequired'));
      return;
    }
    setError(null);
    const response = await fetch('/api/v1/git-connections', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Origin: window.location.origin },
      body: JSON.stringify({
        workspaceId: props.workspaceId,
        provider: selectedProvider,
        owner: owner.trim(),
        repo: repo.trim(),
        branch: branch.trim() || 'main',
        baseUrl: baseUrl.trim() || null,
        accessToken: accessToken.trim(),
        projectId: projectId || null,
        includePaths: includePathList,
        webhookSecret: webhookSecret.trim() || null,
      }),
    });
    const payload = (await response.json()) as {
      connection?: Connection;
      error?: { message?: string };
    };
    if (!response.ok) {
      setError(payload.error?.message ?? t('failedCreate'));
      return;
    }
    closeAdd();
    await refreshConnections();
    router.refresh();
  }

  async function saveManage() {
    if (!manageConnection) return;
    setManageError(null);
    const include = manageIncludePaths
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const body: Record<string, unknown> = {
      branch: manageBranch.trim() || 'main',
      status: manageStatus,
      includePaths: include,
      projectId: manageProjectId || null,
      baseUrl: manageBaseUrl.trim() || null,
    };
    if (manageToken.trim()) {
      body.accessToken = manageToken.trim();
    }
    if (manageWebhook.trim()) {
      body.webhookSecret = manageWebhook.trim();
    }
    const response = await fetch(`/api/v1/git-connections/${manageConnection.id}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Origin: window.location.origin },
      body: JSON.stringify(body),
    });
    const payload = (await response.json()) as {
      connection?: Connection;
      error?: { message?: string };
    };
    if (!response.ok) {
      setManageError(payload.error?.message ?? t('failedUpdate'));
      return;
    }
    await refreshConnections();
    router.refresh();
    closeManage();
  }

  async function runSync(connectionId: string) {
    setManageError(null);
    setError(null);
    const response = await fetch(`/api/v1/git-connections/${connectionId}/sync`, {
      method: 'POST',
      credentials: 'include',
      headers: { Origin: window.location.origin },
    });
    const payload = (await response.json()) as {
      sync?: { stats: Record<string, number> };
      error?: { message?: string };
    };
    if (!response.ok) {
      setManageError(payload.error?.message ?? t('failedSync'));
      setError(payload.error?.message ?? t('failedSync'));
      return;
    }
    await refreshConnections();
    await loadRuns(connectionId);
    router.refresh();
  }

  async function loadRuns(connectionId: string) {
    const response = await fetch(`/api/v1/git-connections/${connectionId}/sync-runs`, {
      credentials: 'include',
    });
    if (!response.ok) return;
    const payload = (await response.json()) as { syncRuns: SyncRun[] };
    setRunsByConnection((prev) => ({ ...prev, [connectionId]: payload.syncRuns }));
  }

  async function removeConnection(connectionId: string) {
    setManageError(null);
    setError(null);
    const response = await fetch(`/api/v1/git-connections/${connectionId}`, {
      method: 'DELETE',
      credentials: 'include',
      headers: { Origin: window.location.origin },
    });
    if (!response.ok && response.status !== 204) {
      const payload = (await response.json()) as { error?: { message?: string } };
      setManageError(payload.error?.message ?? t('failedDelete'));
      setError(payload.error?.message ?? t('failedDelete'));
      return;
    }
    closeManage();
    await refreshConnections();
    router.refresh();
  }

  function formatLastSync(value: string | null): string {
    if (!value) return t('neverSynced');
    return new Date(value).toLocaleString();
  }

  function webhookPathForProvider(provider: SyncProvider): string {
    const slug =
      provider === 'azure_devops'
        ? 'azure-devops'
        : provider;
    return `/api/v1/git/webhooks/${slug}`;
  }

  function fieldLabel(provider: SyncProvider, field: 'owner' | 'repo' | 'token'): string {
    return t(`${field}_${provider}`);
  }

  function fieldPlaceholder(provider: SyncProvider, field: 'owner' | 'repo' | 'token'): string {
    return t(`${field}Placeholder_${provider}`);
  }

  const addFormReady =
    Boolean(selectedProvider) &&
    owner.trim().length > 0 &&
    repo.trim().length > 0 &&
    accessToken.trim().length > 0 &&
    (!selectedProvider ||
      !providerNeedsBaseUrl(selectedProvider) ||
      baseUrl.trim().length > 0);

  return (
    <div className="grid gap-6">
      {error && !addOpen && !manageConnection ? <ErrorText>{error}</ErrorText> : null}

      {props.canManage && props.addOpen === undefined ? (
        <div className="flex justify-end">
          <Button type="button" onClick={openAdd}>
            {t('add')}
          </Button>
        </div>
      ) : null}

      <div className="grid gap-4">
        <h2 className="m-0 text-lg font-semibold">{t('connectionsTitle')}</h2>
        {connections.length === 0 ? (
          <p className="kh-muted">{t('empty')}</p>
        ) : (
          connections.map((connection) => {
            const canSync = isSyncProviderSupported(connection.provider);
            return (
              <Panel key={connection.id} className="grid gap-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="brand">{t(providerLabelKey(connection.provider))}</Badge>
                      <p className="m-0 font-semibold">
                        {connection.owner}/{connection.repo}
                      </p>
                      {connection.syncHealth ? (
                        <Badge
                          tone={healthTone(connection.syncHealth.status)}
                          title={connection.syncHealth.message}
                        >
                          {t(`health_${connection.syncHealth.status}`)}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-1 mb-0 text-sm text-ink-muted">
                      {t('branchLabel', { branch: connection.branch })} · {connection.status}
                    </p>
                    <p className="mt-1 mb-0 text-sm text-ink-muted">
                      {t('lastSynced', { when: formatLastSync(connection.lastSyncedAt) })}
                    </p>
                    {connection.lastError ? (
                      <p className="mt-1 mb-0 text-sm text-danger">{connection.lastError}</p>
                    ) : null}
                    {!canSync ? (
                      <p className="mt-1 mb-0 text-sm text-warn">{t('providerComingSoon')}</p>
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => openManage(connection)}
                  >
                    {t('manage')}
                  </Button>
                </div>
              </Panel>
            );
          })
        )}
      </div>

      <Modal
        open={addOpen}
        onClose={closeAdd}
        title={
          addStep === 'provider'
            ? t('addTitle')
            : selectedProvider
              ? t(`connectTitle_${selectedProvider}`)
              : t('addTitle')
        }
        description={addStep === 'provider' ? t('addBlurb') : undefined}
        size="lg"
      >
        {addStep === 'provider' ? (
          <ul className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2">
            {SYNC_PROVIDER_CATALOG.map((provider) => {
              const supported = provider.syncSupported;
              return (
                <li key={provider.id}>
                  <button
                    type="button"
                    disabled={!supported}
                    className="kh-panel-inset flex w-full cursor-pointer flex-col items-start gap-1 border border-line bg-panel-solid text-left transition hover:border-brand/35 disabled:cursor-not-allowed disabled:opacity-60"
                    onClick={() => {
                      if (!supported) return;
                      setSelectedProvider(provider.id);
                      setAddStep('form');
                      setError(null);
                    }}
                  >
                    <span className="font-medium text-ink">{t(provider.labelKey)}</span>
                    <span className="text-sm text-ink-muted">
                      {supported ? t('providerAvailable') : t('providerComingSoon')}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : selectedProvider ? (
          <div className="grid gap-3">
            <p className="m-0 text-sm text-ink-muted">
              {t(`connectBlurb_${selectedProvider}`)}
            </p>
            <p className="m-0 text-sm text-ink-muted">{t('safetySweepHint')}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={fieldLabel(selectedProvider, 'owner')}>
                <Input
                  autoFocus
                  value={owner}
                  onChange={(e) => setOwner(e.target.value)}
                  placeholder={fieldPlaceholder(selectedProvider, 'owner')}
                />
              </Field>
              <Field label={fieldLabel(selectedProvider, 'repo')}>
                <Input
                  value={repo}
                  onChange={(e) => setRepo(e.target.value)}
                  placeholder={fieldPlaceholder(selectedProvider, 'repo')}
                />
              </Field>
              <Field label={t('branch')}>
                <Input value={branch} onChange={(e) => setBranch(e.target.value)} />
              </Field>
              <Field label={t('projectOptional')}>
                <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                  <option value="">{tCommon('none')}</option>
                  {props.projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </Select>
              </Field>
              {providerShowsBaseUrl(selectedProvider) ? (
                <Field
                  label={
                    providerNeedsBaseUrl(selectedProvider)
                      ? t('baseUrlRequiredLabel')
                      : t('baseUrlOptional')
                  }
                  className="sm:col-span-2"
                >
                  <Input
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder={t(`baseUrlPlaceholder_${selectedProvider}`)}
                    autoComplete="off"
                  />
                </Field>
              ) : null}
              <Field label={fieldLabel(selectedProvider, 'token')} className="sm:col-span-2">
                <PasswordInput
                  value={accessToken}
                  onChange={(e) => setAccessToken(e.target.value)}
                  placeholder={fieldPlaceholder(selectedProvider, 'token')}
                  autoComplete="off"
                />
              </Field>
              <Field label={t('webhookSecret')} className="sm:col-span-2">
                <PasswordInput
                  value={webhookSecret}
                  onChange={(e) => setWebhookSecret(e.target.value)}
                  placeholder={t('webhookSecretHint')}
                  autoComplete="off"
                />
              </Field>
              <p className="m-0 sm:col-span-2 text-sm text-ink-muted">
                {t('webhookPathHint', {
                  path: webhookPathForProvider(selectedProvider),
                })}
              </p>
              <Field label={t('includePaths')} className="sm:col-span-2">
                <Textarea
                  rows={4}
                  value={includePaths}
                  onChange={(e) => setIncludePaths(e.target.value)}
                />
              </Field>
            </div>
            {error ? <ErrorText>{error}</ErrorText> : null}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={pending || !addFormReady}
                onClick={() => startTransition(() => void createConnection())}
              >
                {t('connect')}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={pending}
                onClick={() => {
                  setAddStep('provider');
                  setError(null);
                }}
              >
                {tCommon('back')}
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={manageConnection != null}
        onClose={closeManage}
        title={t('manageTitle')}
        description={
          manageConnection
            ? `${t(providerLabelKey(manageConnection.provider))} · ${manageConnection.owner}/${manageConnection.repo}`
            : undefined
        }
        size="lg"
      >
        {manageConnection ? (
          <div className="grid gap-4">
            <div className="grid gap-2 text-sm text-ink-muted">
              <p className="m-0">
                {t('lastSynced', {
                  when: formatLastSync(manageConnection.lastSyncedAt),
                })}
              </p>
              {manageConnection.syncHealth ? (
                <p className="m-0">
                  <Badge tone={healthTone(manageConnection.syncHealth.status)}>
                    {t(`health_${manageConnection.syncHealth.status}`)}
                  </Badge>
                  <span className="ml-2">{manageConnection.syncHealth.message}</span>
                </p>
              ) : null}
              {manageConnection.lastError ? (
                <p className="m-0 text-danger">{manageConnection.lastError}</p>
              ) : null}
            </div>

            {props.canManage && isSyncProviderSupported(manageConnection.provider) ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t('branch')}>
                  <Input
                    value={manageBranch}
                    onChange={(e) => setManageBranch(e.target.value)}
                  />
                </Field>
                <Field label={t('connectionStatus')}>
                  <Select
                    value={manageStatus}
                    onChange={(e) =>
                      setManageStatus(e.target.value === 'paused' ? 'paused' : 'active')
                    }
                  >
                    <option value="active">{t('statusActive')}</option>
                    <option value="paused">{t('statusPaused')}</option>
                  </Select>
                </Field>
                <Field label={t('projectOptional')} className="sm:col-span-2">
                  <Select
                    value={manageProjectId}
                    onChange={(e) => setManageProjectId(e.target.value)}
                  >
                    <option value="">{tCommon('none')}</option>
                    {props.projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                {providerShowsBaseUrl(manageConnection.provider) ? (
                  <Field
                    label={
                      providerNeedsBaseUrl(manageConnection.provider)
                        ? t('baseUrlRequiredLabel')
                        : t('baseUrlOptional')
                    }
                    className="sm:col-span-2"
                  >
                    <Input
                      value={manageBaseUrl}
                      onChange={(e) => setManageBaseUrl(e.target.value)}
                      placeholder={t(
                        `baseUrlPlaceholder_${manageConnection.provider as SyncProvider}`,
                      )}
                      autoComplete="off"
                    />
                  </Field>
                ) : null}
                <Field label={t('accessToken')} className="sm:col-span-2">
                  <PasswordInput
                    value={manageToken}
                    onChange={(e) => setManageToken(e.target.value)}
                    placeholder={t('tokenLeaveBlank', {
                      preview: manageConnection.accessTokenPreview,
                    })}
                    autoComplete="off"
                  />
                </Field>
                <Field label={t('webhookSecret')} className="sm:col-span-2">
                  <PasswordInput
                    value={manageWebhook}
                    onChange={(e) => setManageWebhook(e.target.value)}
                    placeholder={
                      manageConnection.hasWebhookSecret
                        ? t('webhookLeaveBlank')
                        : t('webhookSecretHint')
                    }
                    autoComplete="off"
                  />
                </Field>
                <p className="m-0 sm:col-span-2 text-sm text-ink-muted">
                  {t('webhookPathHint', {
                    path: webhookPathForProvider(
                      manageConnection.provider as SyncProvider,
                    ),
                  })}
                </p>
                <Field label={t('includePaths')} className="sm:col-span-2">
                  <Textarea
                    rows={4}
                    value={manageIncludePaths}
                    onChange={(e) => setManageIncludePaths(e.target.value)}
                  />
                </Field>
              </div>
            ) : null}

            {manageError ? <ErrorText>{manageError}</ErrorText> : null}

            <div className="flex flex-wrap gap-2">
              {props.canManage && isSyncProviderSupported(manageConnection.provider) ? (
                <>
                  <Button
                    type="button"
                    disabled={pending}
                    onClick={() => startTransition(() => void saveManage())}
                  >
                    {tCommon('save')}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={pending}
                    onClick={() =>
                      startTransition(() => void runSync(manageConnection.id))
                    }
                  >
                    {t('syncNow')}
                  </Button>
                  <Button
                    type="button"
                    variant="danger"
                    disabled={pending}
                    onClick={() =>
                      startTransition(() => void removeConnection(manageConnection.id))
                    }
                  >
                    {t('remove')}
                  </Button>
                </>
              ) : null}
              <Button type="button" variant="secondary" onClick={closeManage}>
                {t('close')}
              </Button>
            </div>

            <div>
              <h3 className="mt-0 mb-2 text-base font-semibold">{t('history')}</h3>
              {(runsByConnection[manageConnection.id] ?? []).length === 0 ? (
                <p className="m-0 text-sm text-ink-muted">{t('historyEmpty')}</p>
              ) : (
                <ul className="m-0 grid list-none gap-2 p-0 text-sm">
                  {(runsByConnection[manageConnection.id] ?? []).slice(0, 12).map((run) => (
                    <li key={run.id} className="text-ink-muted">
                      {new Date(run.createdAt).toLocaleString()} · {run.status} · {run.trigger}
                      {run.stats
                        ? ` · +${run.stats.created ?? 0}/~${run.stats.updated ?? 0}/=${run.stats.skipped ?? 0}/-${run.stats.archived ?? 0}`
                        : ''}
                      {run.errorMessage ? ` · ${run.errorMessage}` : ''}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

export function GitConnectionsAddButton(props: { onClick: () => void }) {
  const t = useTranslations('gitSync');
  return (
    <Button type="button" onClick={props.onClick}>
      {t('add')}
    </Button>
  );
}
