'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { GitConnectionsAddButton, GitConnectionsPanel } from './GitConnectionsPanel';
import { OpsCountStrip } from './ops/OpsCountStrip';
import { Badge, Page, PageHeader } from './ui';

type ProjectOption = { id: string; name: string; slug: string };

type Connection = Parameters<typeof GitConnectionsPanel>[0]['initialConnections'][number];

export function WorkspaceSyncPage(props: {
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
  projects: ProjectOption[];
  connections: Connection[];
  canManage: boolean;
  overallHealth: string | null;
}) {
  const t = useTranslations('gitSync');
  const [addOpen, setAddOpen] = useState(false);
  const healthy = props.connections.filter(
    (connection) => connection.syncHealth?.status === 'healthy',
  ).length;
  const needsSync = props.connections.filter((connection) => {
    const status = connection.syncHealth?.status;
    return status === 'needs_sync' || status === 'never_synced';
  }).length;
  const paused = props.connections.filter(
    (connection) => connection.syncHealth?.status === 'paused',
  ).length;
  const errors = props.connections.filter((connection) => {
    const status = connection.syncHealth?.status;
    return status === 'error' || status === 'check_failed';
  }).length;

  return (
    <Page wide>
      <PageHeader
        eyebrow={t('eyebrow')}
        title={t('title')}
        description={t('subtitle', { workspace: props.workspaceName })}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            {props.overallHealth ? (
              <Badge
                tone={
                  props.overallHealth === 'healthy'
                    ? 'success'
                    : props.overallHealth === 'error'
                      ? 'danger'
                      : 'warn'
                }
              >
                {t(`health_${props.overallHealth}`)}
              </Badge>
            ) : null}
            {props.canManage ? (
              <GitConnectionsAddButton onClick={() => setAddOpen(true)} />
            ) : null}
            <Link
              href={`/workspaces/${props.workspaceSlug}`}
              className="text-sm text-brand no-underline"
            >
              {t('backToWorkspace')}
            </Link>
          </div>
        }
      />
      <OpsCountStrip
        items={[
          { label: t('countConnections'), value: props.connections.length },
          { label: t('countHealthy'), value: healthy },
          { label: t('countNeedsSync'), value: needsSync },
          { label: t('countPaused'), value: paused },
          { label: t('countErrors'), value: errors },
        ]}
      />
      <GitConnectionsPanel
        workspaceId={props.workspaceId}
        projects={props.projects}
        initialConnections={props.connections}
        canManage={props.canManage}
        addOpen={addOpen}
        onAddOpenChange={setAddOpen}
      />
    </Page>
  );
}
