'use client';

import { useTranslations } from 'next-intl';
import { isProjectStage, projectStageTone } from '../lib/project-stage';
import { Badge } from './ui';

export function ProjectStageBadge({ status }: { status: string }) {
  const t = useTranslations('projects');
  const label = isProjectStage(status) ? t(`stage.${status}`) : status;
  return <Badge tone={projectStageTone(status)}>{label}</Badge>;
}

export function ProjectAiCreatedBadge({
  createdVia,
  generatedByModel,
}: {
  createdVia?: string | null;
  generatedByModel?: string | null;
}) {
  const t = useTranslations('projects');
  if (createdVia !== 'mcp') return null;
  const model = generatedByModel?.trim();
  const title = model
    ? `${t('aiCreatedHint')} ${t('aiCreatedModel', { model })}`
    : t('aiCreatedHint');
  return (
    <Badge tone="brand" title={title}>
      {t('aiCreatedBadge')}
    </Badge>
  );
}
