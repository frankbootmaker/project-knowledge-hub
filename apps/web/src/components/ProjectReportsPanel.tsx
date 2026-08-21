'use client';

import { useTranslations } from 'next-intl';
import { CollapsibleSection } from './CollapsibleSection';
import {
  useProjectReportPreview,
  type ProjectReportSource,
} from '../lib/use-project-report-preview';
import type { ProjectReportKind } from './ProjectReportViewer';

export function ProjectReportsPanel({
  project,
}: {
  project: ProjectReportSource;
}) {
  const t = useTranslations('projects');
  const { openReport, reportLoading, reportViewer } = useProjectReportPreview(project);

  const cards: Array<{
    kind: ProjectReportKind;
    title: string;
    hint: string;
  }> = [
    {
      kind: 'status',
      title: t('reportStatus'),
      hint: t('reportStatusHint'),
    },
    {
      kind: 'delivery',
      title: t('reportDelivery'),
      hint: t('reportDeliveryHint'),
    },
    {
      kind: 'stakeholders',
      title: t('reportStakeholders'),
      hint: t('reportStakeholdersHint'),
    },
  ];

  return (
    <>
      <CollapsibleSection
        id="project-reports"
        storageKey={`project:${project.id}:reports`}
        title={t('manageReports')}
        defaultOpen
      >
        <p className="mt-0 mb-3 text-sm text-ink-muted">{t('manageReportsHint')}</p>
        <div className="kh-ops-project-grid px-0">
          {cards.map((card) => (
            <button
              key={card.kind}
              type="button"
              className="kh-ops-project-card w-full text-left"
              disabled={reportLoading}
              onClick={() => void openReport(card.kind)}
            >
              <div className="kh-ops-card-body">
                <h3>{card.title}</h3>
                <p>{card.hint}</p>
              </div>
              <div className="kh-ops-project-card-foot">
                <span>
                  {reportLoading ? t('reportLoading') : t('manageReports')}
                </span>
              </div>
            </button>
          ))}
        </div>
      </CollapsibleSection>
      {reportViewer}
    </>
  );
}
