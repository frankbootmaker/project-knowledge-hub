'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { WorkspaceManageMenu } from './WorkspaceManageMenu';
import { WorkspaceStatusBadge } from './WorkspaceStatusBadge';
import { resolveWorkspaceStatus, type WorkspaceStatus } from '../lib/workspace-status';

export function WorkspaceHomeActions({
  workspaceId,
  workspaceSlug,
  workspaceName,
  archived,
  color,
  canManageWorkspace,
  initialGitStatuses,
  details,
}: {
  workspaceId: string;
  workspaceSlug: string;
  workspaceName: string;
  archived: boolean;
  color: string | null;
  canManageWorkspace: boolean;
  initialGitStatuses: Array<string | null | undefined>;
  details: {
    id: string;
    slug: string;
    description: string | null;
    createdAt: string;
    updatedAt: string;
    archived: boolean;
    ownerNames: string[];
    projectCount: number;
    systemCount: number;
    recordCount: number;
    gitConnectionCount: number;
    memberAdminCount: number;
  };
}) {
  const tGit = useTranslations('gitSync');
  const [gitStatuses, setGitStatuses] = useState(initialGitStatuses);
  useEffect(() => {
    if (archived || details.gitConnectionCount === 0) return;
    let cancelled = false;
    void fetch(`/api/v1/workspaces/${workspaceId}/git-connections?checkRemote=true`, {
      credentials: 'include',
    })
      .then(async (response) => {
        if (!response.ok || cancelled) return;
        const body = (await response.json()) as {
          connections?: Array<{ syncHealth?: { status: string } | null }>;
        };
        if (cancelled) return;
        setGitStatuses((body.connections ?? []).map((connection) => connection.syncHealth?.status));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [archived, details.gitConnectionCount, workspaceId]);

  const status: WorkspaceStatus = resolveWorkspaceStatus({
    archived,
    workspaceSlug,
    gitHealthStatuses: gitStatuses,
  });
  const gitHealthLabel = status.gitHealth
    ? tGit(`health_${status.gitHealth}`)
    : status.kind === 'healthy' && details.gitConnectionCount > 0
      ? tGit('health_healthy')
      : null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <WorkspaceStatusBadge status={status} />
      <WorkspaceManageMenu
        workspaceId={workspaceId}
        workspaceSlug={workspaceSlug}
        workspaceName={workspaceName}
        archived={archived}
        color={color}
        canManageArchive={canManageWorkspace}
        canManageColor={canManageWorkspace}
        canEditDetails={canManageWorkspace}
        gitHealthLabel={gitHealthLabel}
        details={details}
      />
    </div>
  );
}
