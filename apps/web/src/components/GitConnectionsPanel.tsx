'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  Badge,
  Button,
  ErrorText,
  Field,
  Input,
  Panel,
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
  owner: string;
  repo: string;
  branch: string;
  projectId: string | null;
  status: string;
  lastError: string | null;
  lastSyncedAt: string | null;
  lastSyncedCommitSha: string | null;
  accessTokenPreview: string;
  includePaths: string[];
  excludePaths: string[];
  syncHealth: SyncHealth | null;
};

function healthTone(status: SyncHealthStatus): 'success' | 'warn' | 'danger' | 'neutral' {
  if (status === 'healthy') return 'success';
  if (status === 'needs_sync' || status === 'never_synced' || status === 'check_failed') {
    return 'warn';
  }
  if (status === 'error') return 'danger';
  return 'neutral';
}

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

export function GitConnectionsPanel(props: {
  workspaceId: string;
  projects: ProjectOption[];
  initialConnections: Connection[];
  canManage: boolean;
}) {
  const t = useTranslations('gitSync');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const [connections, setConnections] = useState(props.initialConnections);
  const [runsByConnection, setRunsByConnection] = useState<Record<string, SyncRun[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [owner, setOwner] = useState('');
  const [repo, setRepo] = useState('');
  const [branch, setBranch] = useState('main');
  const [accessToken, setAccessToken] = useState('');
  const [projectId, setProjectId] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [includePaths, setIncludePaths] = useState('docs/**/*.md\nREADME.md\n**/ADR-*.md');

  const includePathList = useMemo(
    () =>
      includePaths
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
    [includePaths],
  );

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
    setError(null);
    const response = await fetch('/api/v1/git-connections', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Origin: window.location.origin },
      body: JSON.stringify({
        workspaceId: props.workspaceId,
        owner: owner.trim(),
        repo: repo.trim(),
        branch: branch.trim() || 'main',
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
    setOwner('');
    setRepo('');
    setAccessToken('');
    setWebhookSecret('');
    await refreshConnections();
    router.refresh();
  }

  async function runSync(connectionId: string) {
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
    setError(null);
    const response = await fetch(`/api/v1/git-connections/${connectionId}`, {
      method: 'DELETE',
      credentials: 'include',
      headers: { Origin: window.location.origin },
    });
    if (!response.ok && response.status !== 204) {
      const payload = (await response.json()) as { error?: { message?: string } };
      setError(payload.error?.message ?? t('failedDelete'));
      return;
    }
    await refreshConnections();
    router.refresh();
  }

  return (
    <div className="grid gap-6">
      {error ? <ErrorText>{error}</ErrorText> : null}

      {props.canManage ? (
        <Panel className="grid gap-3">
          <h2 className="m-0 text-lg font-semibold">{t('connectTitle')}</h2>
          <p className="m-0 text-sm text-ink-muted">{t('connectBlurb')}</p>
          <p className="m-0 text-sm text-ink-muted">{t('safetySweepHint')}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('owner')}>
              <Input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="org-or-user" />
            </Field>
            <Field label={t('repo')}>
              <Input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="repo-name" />
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
            <Field label={t('accessToken')} className="sm:col-span-2">
              <Input
                type="password"
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                placeholder="github_pat_…"
                autoComplete="off"
              />
            </Field>
            <Field label={t('webhookSecret')} className="sm:col-span-2">
              <Input
                type="password"
                value={webhookSecret}
                onChange={(e) => setWebhookSecret(e.target.value)}
                placeholder={t('webhookSecretHint')}
                autoComplete="off"
              />
            </Field>
            <Field label={t('includePaths')} className="sm:col-span-2">
              <Textarea
                rows={4}
                value={includePaths}
                onChange={(e) => setIncludePaths(e.target.value)}
              />
            </Field>
          </div>
          <div>
            <Button
              type="button"
              disabled={pending || !owner.trim() || !repo.trim() || !accessToken.trim()}
              onClick={() => startTransition(() => void createConnection())}
            >
              {t('connect')}
            </Button>
          </div>
        </Panel>
      ) : null}

      <div className="grid gap-4">
        <h2 className="m-0 text-lg font-semibold">{t('connectionsTitle')}</h2>
        {connections.length === 0 ? (
          <p className="kh-muted">{t('empty')}</p>
        ) : (
          connections.map((connection) => (
            <Panel key={connection.id} className="grid gap-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
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
                  <p className="m-0 text-sm text-ink-muted">
                    {t('branchLabel', { branch: connection.branch })} · {connection.status}
                    {connection.lastSyncedCommitSha
                      ? ` · ${connection.lastSyncedCommitSha.slice(0, 7)}`
                      : ''}
                    {connection.syncHealth?.remoteCommitSha &&
                    connection.syncHealth.remoteCommitSha !== connection.lastSyncedCommitSha
                      ? ` → ${connection.syncHealth.remoteCommitSha.slice(0, 7)}`
                      : ''}
                  </p>
                  {connection.syncHealth?.status === 'needs_sync' ||
                  connection.syncHealth?.status === 'never_synced' ? (
                    <p className="m-0 text-sm text-warn">{connection.syncHealth.message}</p>
                  ) : null}
                  {connection.lastError ? (
                    <p className="m-0 text-sm text-danger">{connection.lastError}</p>
                  ) : null}
                </div>
                {props.canManage ? (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={pending}
                      onClick={() => startTransition(() => void runSync(connection.id))}
                    >
                      {t('syncNow')}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={pending}
                      onClick={() => startTransition(() => void loadRuns(connection.id))}
                    >
                      {t('history')}
                    </Button>
                    <Button
                      type="button"
                      variant="danger"
                      disabled={pending}
                      onClick={() => startTransition(() => void removeConnection(connection.id))}
                    >
                      {t('remove')}
                    </Button>
                  </div>
                ) : null}
              </div>
              {(runsByConnection[connection.id] ?? []).length > 0 ? (
                <ul className="m-0 grid list-none gap-2 p-0 text-sm">
                  {(runsByConnection[connection.id] ?? []).slice(0, 8).map((run) => (
                    <li key={run.id} className="text-ink-muted">
                      {new Date(run.createdAt).toLocaleString()} · {run.status} · {run.trigger}
                      {run.stats
                        ? ` · +${run.stats.created ?? 0}/~${run.stats.updated ?? 0}/=${run.stats.skipped ?? 0}/-${run.stats.archived ?? 0}`
                        : ''}
                      {run.errorMessage ? ` · ${run.errorMessage}` : ''}
                    </li>
                  ))}
                </ul>
              ) : null}
            </Panel>
          ))
        )}
      </div>
    </div>
  );
}
