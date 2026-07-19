'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { WorkspaceStatus } from '../lib/workspace-status';
import { Badge } from './ui';
import { cn } from '../lib/cn';

function toneFor(
  status: WorkspaceStatus,
): 'success' | 'warn' | 'danger' | 'neutral' {
  if (status.kind === 'healthy') return 'success';
  if (status.kind === 'archived') return 'neutral';
  if (status.gitHealth === 'error') return 'danger';
  return 'warn';
}

export function WorkspaceStatusBadge(props: {
  status: WorkspaceStatus;
  className?: string;
}) {
  const t = useTranslations('workspaces');
  const tGit = useTranslations('gitSync');
  const { status } = props;

  let label = t('statusHealthy');
  if (status.kind === 'archived') {
    label = t('statusArchived');
  } else if (status.kind === 'needs_attention') {
    label = status.gitHealth
      ? t('statusNeedsAttentionDetail', {
          detail: tGit(`health_${status.gitHealth}`),
        })
      : t('statusNeedsAttention');
  }

  const badge = (
    <Badge tone={toneFor(status)} className={cn(props.className)}>
      {label}
    </Badge>
  );

  if (status.kind === 'needs_attention' && status.attentionHref) {
    return (
      <Link
        href={status.attentionHref}
        className="inline-flex no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
        title={t('statusNeedsAttentionHint')}
      >
        {badge}
      </Link>
    );
  }

  return badge;
}
