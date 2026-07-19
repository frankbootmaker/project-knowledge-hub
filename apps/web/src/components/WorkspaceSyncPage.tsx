'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import {
  GitConnectionsAddButton,
  GitConnectionsPanel,
} from './GitConnectionsPanel';
import { Page, PageHeader } from './ui';

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

  return (
    <Page wide>
      <PageHeader
        title={t('title')}
        description={t('subtitle', { workspace: props.workspaceName })}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            {props.overallHealth ? (
              <span className="text-sm text-ink-muted" title={t(`health_${props.overallHealth}`)}>
                {t('overallHealth')}: {t(`health_${props.overallHealth}`)}
              </span>
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
