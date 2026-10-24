'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { TableFilterControl, type TableFilterField } from './ui/TableFilterControl';
import {
  applyTableView,
  collectEnumOptions,
  type TableColumnSpec,
} from '../lib/data-table';
import { useSyncEnumFilters, useTableState } from '../lib/use-table-state';
import {
  SYNC_PROVIDER_CATALOG,
  isSyncProviderSupported,
  providerNeedsBaseUrl,
  providerShowsBaseUrl,
  type SyncProvider,
} from '@project-knowledge-hub/domain';
import { LocalDateTime } from './LocalDateTime';
import {
  Badge,
  Button,
  ErrorText,
  Field,
  Input,
  Modal,
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

const DEFAULT_PAGE_SIZE = 5;
const PAGE_SIZE_OPTIONS = [5, 10, 25, 50] as const;
type PageSizeOption = (typeof PAGE_SIZE_OPTIONS)[number];

function isPageSizeOption(value: number): value is PageSizeOption {
  return (PAGE_SIZE_OPTIONS as readonly number[]).includes(value);
}

function pageSlice<T>(items: T[], page: number, pageSize: number) {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize) || 1);
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const pageStart = (currentPage - 1) * pageSize;
  return {
    pageItems: items.slice(pageStart, pageStart + pageSize),
    currentPage,
    totalPages,
    rangeFrom: items.length === 0 ? 0 : pageStart + 1,
    rangeTo: Math.min(pageStart + pageSize, items.length),
  };
}

function ConnectionPager({
  title,
  total,
  page,
  pageSize,
  onPage,
  onPageSize,
}: {
  title: string;
  total: number;
  page: number;
  pageSize: PageSizeOption;
  onPage: (page: number) => void;
  onPageSize: (size: PageSizeOption) => void;
}) {
  const t = useTranslations('gitSync');
  if (total === 0) return null;
  const { currentPage, totalPages, rangeFrom, rangeTo } = pageSlice(
    Array.from({ length: total }),
    page,
    pageSize,
  );
  return (
    <div className="kh-ops-card-foot kh-ops-catalogue-pager">
      <p className="m-0 text-ink-muted">
        {t('sectionShowing', { from: rangeFrom, to: rangeTo, total })}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={String(pageSize)}
          onChange={(event) => {
            const parsed = Number(event.target.value);
            onPageSize(isPageSizeOption(parsed) ? parsed : DEFAULT_PAGE_SIZE);
          }}
          aria-label={t('sectionPageSize')}
          className="h-10 min-h-10 w-auto min-w-[9rem] py-1.5"
        >
          {PAGE_SIZE_OPTIONS.map((size) => (
            <option key={size} value={String(size)}>
              {t('sectionPageSizeOption', { count: size })}
            </option>
          ))}
        </Select>
        {totalPages > 1 ? (
          <nav className="flex flex-wrap items-center gap-2" aria-label={title}>
            <Button
              type="button"
              variant="secondary"
              disabled={currentPage <= 1}
              onClick={() => onPage(Math.max(1, currentPage - 1))}
            >
              {t('sectionPrevPage')}
            </Button>
            <span className="kh-page-num-active" aria-current="page">
              {currentPage} / {totalPages}
            </span>
            <Button
              type="button"
              variant="secondary"
              disabled={currentPage >= totalPages}
              onClick={() => onPage(Math.min(totalPages, currentPage + 1))}
            >
              {t('sectionNextPage')}
            </Button>
          </nav>
        ) : null}
      </div>
    </div>
  );
}

export function GitConnectionsPanel(props: {
  workspaceId: string;
  projects: ProjectOption[];
  initialConnections: Connection[];
  canManage: boolean;
}) {
  const t = useTranslations('gitSync');
  const tCommon = useTranslations('common');
  const tTable = useTranslations('table');
  const locale = useLocale();
  const router = useRouter();
  const [connections, setConnections] = useState(props.initialConnections);
  const [runsByConnection, setRunsByConnection] = useState<Record<string, SyncRun[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const table = useTableState({ namespace: 'wsync', defaultSortKey: null });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSizeOption>(DEFAULT_PAGE_SIZE);

  const [addOpen, setAddOpen] = useState(false);

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

  const sawLiveRemote = useRef(false);

  useEffect(() => {
    if (!sawLiveRemote.current) setConnections(props.initialConnections);
  }, [props.initialConnections]);

  useEffect(() => {
    sawLiveRemote.current = false;
    let cancelled = false;
    void fetch(`/api/v1/workspaces/${props.workspaceId}/git-connections?checkRemote=true`, {
      credentials: 'include',
    })
      .then(async (response) => {
        if (!response.ok || cancelled) return;
        const payload = (await response.json()) as { connections: Connection[] };
        if (cancelled) return;
        sawLiveRemote.current = true;
        setConnections(payload.connections);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [props.workspaceId]);

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

  async function clearHistory(connectionId: string) {
    if (!window.confirm(t('clearHistoryConfirm'))) {
      return;
    }
    setManageError(null);
    setError(null);
    const response = await fetch(`/api/v1/git-connections/${connectionId}/sync-runs`, {
      method: 'DELETE',
      credentials: 'include',
      headers: { Origin: window.location.origin },
    });
    if (!response.ok && response.status !== 204) {
      const payload = (await response.json()) as { error?: { message?: string } };
      setManageError(payload.error?.message ?? t('failedClearHistory'));
      setError(payload.error?.message ?? t('failedClearHistory'));
      return;
    }
    await loadRuns(connectionId);
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

  const providerOptions = useMemo(
    () =>
      collectEnumOptions(
        connections,
        (connection) => connection.provider,
        (value) => t(providerLabelKey(value)),
        locale,
      ),
    [connections, locale, t],
  );
  const healthOptions = useMemo(
    () =>
      collectEnumOptions(
        connections,
        (connection) => connection.syncHealth?.status ?? null,
        (value) => t(`health_${value as SyncHealthStatus}`),
        locale,
      ),
    [connections, locale, t],
  );
  const statusOptions = useMemo(
    () =>
      collectEnumOptions(
        connections,
        (connection) => connection.status,
        (value) =>
          value === 'paused'
            ? t('statusPaused')
            : value === 'active'
              ? t('statusActive')
              : value,
        locale,
      ),
    [connections, locale, t],
  );
  const connectionColumns = useMemo<Array<TableColumnSpec<Connection>>>(
    () => [
      {
        id: 'provider',
        filter: {
          type: 'enum',
          getValue: (connection) => connection.provider,
          options: providerOptions,
        },
      },
      {
        id: 'health',
        filter: {
          type: 'enum',
          getValue: (connection) => connection.syncHealth?.status ?? null,
          options: healthOptions,
        },
      },
      {
        id: 'status',
        filter: {
          type: 'enum',
          getValue: (connection) => connection.status,
          options: statusOptions,
        },
      },
    ],
    [healthOptions, providerOptions, statusOptions],
  );
  useSyncEnumFilters(table.filters, connectionColumns, table.setEnumFilter);

  const filteredConnections = useMemo(
    () =>
      applyTableView({
        rows: connections,
        locale,
        query: table.query,
        search: (connection, needle) =>
          [
            connection.owner,
            connection.repo,
            `${connection.owner}/${connection.repo}`,
            connection.branch,
            t(providerLabelKey(connection.provider)),
            connection.status === 'paused'
              ? t('statusPaused')
              : connection.status === 'active'
                ? t('statusActive')
                : connection.status,
            connection.syncHealth
              ? t(`health_${connection.syncHealth.status}`)
              : '',
          ]
            .join(' ')
            .toLowerCase()
            .includes(needle),
        sortKey: null,
        sortDir: 'asc',
        filters: table.filters,
        textFilters: table.textFilters,
        columns: connectionColumns,
      }),
    [
      connectionColumns,
      connections,
      locale,
      t,
      table.filters,
      table.query,
      table.textFilters,
    ],
  );
  const connectionFields = useMemo<TableFilterField[]>(
    () => [
      {
        id: 'provider',
        header: t('colProvider'),
        type: 'enum',
        options: providerOptions,
      },
      {
        id: 'health',
        header: t('overallHealth'),
        type: 'enum',
        options: healthOptions,
      },
      {
        id: 'status',
        header: t('colStatus'),
        type: 'enum',
        options: statusOptions,
      },
    ],
    [healthOptions, providerOptions, statusOptions, t],
  );
  const connectionSlice = pageSlice(filteredConnections, page, pageSize);

  useEffect(() => {
    setPage(1);
  }, [table.filters, table.query, table.textFilters]);

  function changePageSize(size: PageSizeOption) {
    setPageSize(size);
    setPage(1);
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

      <section className="kh-ops-panel">
        <div className="kh-ops-toolbar mb-0 border-0 border-b border-line">
          <Input
            type="search"
            value={table.query}
            onChange={(event) => table.setQuery(event.target.value)}
            placeholder={t('searchPlaceholder')}
            className="h-10 min-h-10 min-w-[220px] flex-1 py-1.5 text-xs"
          />
          <TableFilterControl
            fields={connectionFields}
            enumFilters={table.filters}
            textFilters={table.textFilters}
            onEnumFilter={table.setEnumFilter}
            onTextFilter={table.setTextFilter}
            onClearFilters={table.clearFilters}
            filtersActive={table.filtersActive}
          />
          {table.filtersActive ? (
            <Button
              type="button"
              variant="secondary"
              className="kh-ops-tree-filter-clear h-8 min-h-8 px-2 text-xs"
              onClick={table.clearFilters}
            >
              {tTable('clearFilters')}
            </Button>
          ) : null}
          {props.canManage ? (
            <Button type="button" onClick={openAdd}>
              {t('new')}
            </Button>
          ) : null}
        </div>
        {filteredConnections.length === 0 ? (
          <p className="kh-ops-empty">
            {table.query.trim() || table.filtersActive ? t('emptyFiltered') : t('empty')}
          </p>
        ) : (
          <div className="kh-ops-table-wrap">
            <table className="kh-ops-data-table">
              <thead>
                <tr>
                  <th>{t('colRepository')}</th>
                  <th>{t('branch')}</th>
                  <th>{t('overallHealth')}</th>
                  <th>{t('colStatus')}</th>
                  <th>{t('colLastSync')}</th>
                  <th>{t('colActions')}</th>
                </tr>
              </thead>
              <tbody>
                {connectionSlice.pageItems.map((connection) => {
                  const canSync = isSyncProviderSupported(connection.provider);
                  return (
                    <tr key={connection.id}>
                      <td className="kh-ops-primary-cell">
                        <span className="kh-ops-type-chip">
                          {t(providerLabelKey(connection.provider))}
                        </span>{' '}
                        {connection.owner}/{connection.repo}
                        {!canSync ? (
                          <p className="m-0 mt-1 text-xs text-warn">
                            {t('providerComingSoon')}
                          </p>
                        ) : null}
                        {connection.lastError ? (
                          <p className="m-0 mt-1 text-xs text-danger">
                            {connection.lastError}
                          </p>
                        ) : null}
                      </td>
                      <td>{connection.branch}</td>
                      <td>
                        {connection.syncHealth ? (
                          <Badge
                            tone={healthTone(connection.syncHealth.status)}
                            title={connection.syncHealth.message}
                          >
                            {t(`health_${connection.syncHealth.status}`)}
                          </Badge>
                        ) : (
                          tCommon('emDash')
                        )}
                      </td>
                      <td>
                        <span className="kh-ops-type-chip">{connection.status}</span>
                      </td>
                      <td>
                        {connection.lastSyncedAt ? (
                          <LocalDateTime value={connection.lastSyncedAt} />
                        ) : (
                          t('neverSynced')
                        )}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="kh-ops-text-btn"
                          onClick={() => openManage(connection)}
                        >
                          {t('manage')}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <ConnectionPager
          title={t('connectionsTitle')}
          total={filteredConnections.length}
          page={page}
          pageSize={pageSize}
          onPage={setPage}
          onPageSize={changePageSize}
        />
      </section>

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
          <ul className="kh-ops-storage-choice m-0 list-none p-0">
            {SYNC_PROVIDER_CATALOG.map((provider) => {
              const supported = provider.syncSupported;
              return (
                <li key={provider.id}>
                  <button
                    type="button"
                    disabled={!supported}
                    className="kh-ops-choice kh-ops-choice-stack h-full"
                    onClick={() => {
                      if (!supported) return;
                      setSelectedProvider(provider.id);
                      setAddStep('form');
                      setError(null);
                    }}
                  >
                    <span className="kh-ops-choice-copy">
                      <strong>{t(provider.labelKey)}</strong>
                      <span>
                        {supported ? t('providerAvailable') : t('providerComingSoon')}
                      </span>
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
            <div className="kh-ops-form-grid">
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
                  className="kh-ops-field-span"
                >
                  <Input
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder={t(`baseUrlPlaceholder_${selectedProvider}`)}
                    autoComplete="off"
                  />
                </Field>
              ) : null}
              <Field label={fieldLabel(selectedProvider, 'token')} className="kh-ops-field-span">
                <PasswordInput
                  value={accessToken}
                  onChange={(e) => setAccessToken(e.target.value)}
                  placeholder={fieldPlaceholder(selectedProvider, 'token')}
                  autoComplete="off"
                />
              </Field>
              <Field label={t('webhookSecret')} className="kh-ops-field-span">
                <PasswordInput
                  value={webhookSecret}
                  onChange={(e) => setWebhookSecret(e.target.value)}
                  placeholder={t('webhookSecretHint')}
                  autoComplete="off"
                />
              </Field>
              <p className="kh-ops-field-span m-0 text-sm text-ink-muted">
                {t('webhookPathHint', {
                  path: webhookPathForProvider(selectedProvider),
                })}
              </p>
              <Field label={t('includePaths')} className="kh-ops-field-span">
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
              <div className="kh-ops-form-grid">
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
                <Field label={t('projectOptional')} className="kh-ops-field-span">
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
                    className="kh-ops-field-span"
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
                <Field label={t('accessToken')} className="kh-ops-field-span">
                  <PasswordInput
                    value={manageToken}
                    onChange={(e) => setManageToken(e.target.value)}
                    placeholder={t('tokenLeaveBlank', {
                      preview: manageConnection.accessTokenPreview,
                    })}
                    autoComplete="off"
                  />
                </Field>
                <Field label={t('webhookSecret')} className="kh-ops-field-span">
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
                <p className="kh-ops-field-span m-0 text-sm text-ink-muted">
                  {t('webhookPathHint', {
                    path: webhookPathForProvider(
                      manageConnection.provider as SyncProvider,
                    ),
                  })}
                </p>
                <Field label={t('includePaths')} className="kh-ops-field-span">
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
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h3 className="m-0 text-base font-semibold">{t('history')}</h3>
                {props.canManage &&
                (runsByConnection[manageConnection.id] ?? []).length > 0 ? (
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={pending}
                    onClick={() =>
                      startTransition(() => void clearHistory(manageConnection.id))
                    }
                  >
                    {t('clearHistory')}
                  </Button>
                ) : null}
              </div>
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
