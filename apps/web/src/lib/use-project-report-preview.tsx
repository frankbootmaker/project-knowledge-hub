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
  type ReportOverviewCopy,
} from './project-reports';

export type ProjectReportSource = {
  id: string;
  name: string;
  slug: string;
  status: string;
  summary: string | null;
};

function reportOverview(
  t: (
    key: string,
    values?: Record<string, string | number>,
  ) => string,
  none: string,
): ReportOverviewCopy {
  return {
    atAGlance: t('reportAtAGlance'),
    keyNumbers: (input) => t('reportKeyNumbers', input),
    completedLast24h: t('reportCompletedLast24h'),
    plannedNext24h: t('reportPlannedNext24h'),
    whereWeStand: t('reportWhereWeStand'),
    groupBlocked: t('reportGroupBlocked'),
    groupInProgress: t('reportGroupInProgress'),
    groupTodo: t('reportGroupTodo'),
    groupDone: t('reportGroupDone'),
    groupCancelled: t('reportGroupCancelled'),
    more: (count) => t('reportMore', { count }),
    none,
    overdueLine: (count, titles) => t('reportOverdueLine', { count, titles }),
    blockedRisksLine: (input) => t('reportBlockedRisksLine', input),
    activeSprintLine: (input) => t('reportActiveSprintLine', input),
    noActiveSprint: t('reportNoActiveSprint'),
    nextMilestoneLine: (input) => t('reportNextMilestoneLine', input),
    noNextMilestone: t('reportNoNextMilestone'),
    cpiSpiLine: (input) => t('reportCpiSpiLine', input),
    ownerWorkloadLine: (owners) => t('reportOwnerWorkloadLine', { owners }),
    due: (date) => t('reportDue', { date }),
    points: (count) => t('reportPointsShort', { count }),
    target: (date) => t('reportTarget', { date }),
    sprintStarts: (date) => t('reportSprintStarts', { date }),
    sprintEnds: (date) => t('reportSprintEnds', { date }),
    sprintWindow: (start, end) => t('reportSprintWindow', { start, end }),
    taskKind: t('reportKindTask'),
    milestoneKind: t('reportKindMilestone'),
    sprintKind: t('reportKindSprint'),
  };
}

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
  const overview = reportOverview(
    t as (
      key: string,
      values?: Record<string, string | number>,
    ) => string,
    tCommon('none'),
  );
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
      const timeZone =
        Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
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
          sprints: data.sprints,
          raidItems: data.raidItems,
          budget: data.budget,
          timeZone,
          overview,
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
            diagramEmpty: t('reportDiagramEmpty'),
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
            diagramEmpty: t('reportDiagramEmpty'),
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
          sprints: data.sprints,
          timeZone,
          overview,
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
            diagramEmpty: t('reportDiagramEmpty'),
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
