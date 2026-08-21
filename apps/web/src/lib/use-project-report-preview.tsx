'use client';

import { useState, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  ProjectReportViewer,
  type ProjectReportKind,
} from '../components/ProjectReportViewer';
import {
  buildDeliveryStatusReport,
  buildProjectStatusReport,
  buildStakeholdersReport,
  computeReportRags,
  fetchProjectReportData,
  fetchReportDiagramPrefs,
} from './project-reports';

export type ProjectReportSource = {
  id: string;
  name: string;
  slug: string;
  status: string;
  summary: string | null;
};

export function useProjectReportPreview(
  project: ProjectReportSource,
  options?: { onOpen?: () => void },
): {
  openReport: (kind: ProjectReportKind) => Promise<void>;
  reportLoading: boolean;
  reportViewer: ReactNode;
} {
  const t = useTranslations('projects');
  const tBaseline = useTranslations('baseline');
  const tBudget = useTranslations('budget');
  const tRaid = useTranslations('raid');
  const tCommon = useTranslations('common');
  const tStakeholders = useTranslations('stakeholders');
  const tDelivery = useTranslations('delivery');
  const locale = useLocale();
  const [reportOpen, setReportOpen] = useState(false);
  const [reportKind, setReportKind] = useState<ProjectReportKind | null>(null);
  const [reportTitle, setReportTitle] = useState('');
  const [reportMarkdown, setReportMarkdown] = useState('');
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  function closeReport() {
    setReportOpen(false);
    setReportKind(null);
    setReportTitle('');
    setReportMarkdown('');
    setReportError(null);
    setReportLoading(false);
  }

  async function openReport(kind: ProjectReportKind) {
    const titles: Record<ProjectReportKind, string> = {
      delivery: t('reportDeliveryTitle'),
      stakeholders: t('reportStakeholdersTitle'),
      status: t('reportStatusTitle'),
    };
    setReportKind(kind);
    setReportTitle(titles[kind]);
    setReportMarkdown('');
    setReportError(null);
    setReportLoading(true);
    setReportOpen(true);
    options?.onOpen?.();

    try {
      const [data, diagrams] = await Promise.all([
        fetchProjectReportData(project.id),
        fetchReportDiagramPrefs(),
      ]);
      const rags = computeReportRags(data);
      const timelineRagValue = t(`rag.${rags.timelineRag}`);
      const riskRagValue = t(`rag.${rags.riskRag}`);
      const financialRagValue = t(`rag.${rags.financialRag}`);
      const currency = data.budget?.currency ?? 'EUR';
      const diagramLabels = {
        orgHierarchy: t('reportDiagramOrg'),
        raidBreakdown: t('reportDiagramRaid'),
        deliveryTimeline: t('reportDiagramDelivery'),
        budgetBurndown: t('reportDiagramBudget'),
        milestonesSection: tDelivery('kindMilestone'),
        tasksSection: tDelivery('kindTask'),
      };

      let markdown = '';
      if (kind === 'delivery') {
        markdown = buildDeliveryStatusReport({
          projectName: project.name,
          projectSlug: project.slug,
          projectStatus: project.status,
          milestones: data.milestones,
          tasks: data.tasks,
          diagrams,
          diagramLabels,
          labels: {
            title: t('reportDeliveryTitle'),
            generated: t('reportGenerated'),
            timelineRag: t('ragTimeline'),
            timelineRagValue,
            milestones: tDelivery('kindMilestone'),
            tasks: tDelivery('kindTask'),
            none: tCommon('none'),
            forecastHours: tDelivery('forecastHours'),
            actualHours: tDelivery('actualHours'),
          },
        });
      } else if (kind === 'stakeholders') {
        markdown = buildStakeholdersReport({
          projectName: project.name,
          projectSlug: project.slug,
          stakeholders: data.stakeholders,
          currency,
          locale,
          diagrams,
          diagramLabels,
          labels: {
            title: t('reportStakeholdersTitle'),
            generated: t('reportGenerated'),
            people: t('reportPeople'),
            aiAssistants: tStakeholders('kindAiAssistant'),
            none: tCommon('none'),
            reportsTo: tStakeholders('reportsTo'),
            hourlyRate: tStakeholders('hourlyRate'),
          },
        });
      } else {
        markdown = buildProjectStatusReport({
          projectName: project.name,
          projectSlug: project.slug,
          projectStatus: project.status,
          summary: project.summary,
          milestones: data.milestones,
          tasks: data.tasks,
          stakeholders: data.stakeholders,
          raidItems: data.raidItems,
          budget: data.budget,
          locale,
          diagrams,
          diagramLabels,
          labels: {
            statusTitle: t('reportStatusTitle'),
            deliveryTitle: t('reportDeliveryTitle'),
            stakeholdersTitle: t('reportStakeholdersTitle'),
            budgetTitle: tBudget('title'),
            raidTitle: tRaid('title'),
            generated: t('reportGenerated'),
            timelineRag: t('ragTimeline'),
            timelineRagValue,
            riskRag: t('ragRisks'),
            riskRagValue,
            financialRag: t('ragFinancials'),
            financialRagValue,
            milestones: tDelivery('kindMilestone'),
            tasks: tDelivery('kindTask'),
            people: t('reportPeople'),
            aiAssistants: tStakeholders('kindAiAssistant'),
            none: tCommon('none'),
            reportsTo: tStakeholders('reportsTo'),
            hourlyRate: tStakeholders('hourlyRate'),
            summary: tCommon('summary'),
            forecastHours: tDelivery('forecastHours'),
            actualHours: tDelivery('actualHours'),
            currency: tBaseline('currency'),
            initialBudget: tBaseline('initialBudget'),
            approvedBudget: tBudget('approvedBudget'),
            bac: tBudget('kpi.bac'),
            ev: tBudget('kpi.ev'),
            ac: tBudget('kpi.ac'),
            pv: t('reportPv'),
            cpi: tBudget('kpi.cpi'),
            spi: tBudget('kpi.spi'),
          },
          kindLabel: (kindValue) => tRaid(`kind.${kindValue}`),
          statusLabel: (statusValue) => tRaid(`status.${statusValue}`),
          severityLabel: (severityValue) => tRaid(`severity.${severityValue}`),
        });
      }

      setReportMarkdown(markdown);
    } catch (err) {
      setReportError(err instanceof Error ? err.message : t('reportFailed'));
    } finally {
      setReportLoading(false);
    }
  }

  return {
    openReport,
    reportLoading,
    reportViewer: (
      <ProjectReportViewer
        open={reportOpen}
        onClose={closeReport}
        projectName={project.name}
        projectId={project.id}
        kind={reportKind}
        title={reportTitle}
        markdown={reportMarkdown}
        loading={reportLoading}
        error={reportError}
      />
    ),
  };
}
