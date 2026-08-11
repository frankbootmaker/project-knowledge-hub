import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import {
  ProjectBaselinePanel,
  type InitialStakeholder,
} from '../../../../../../components/ProjectBaselinePanel';
import {
  ProjectChangePanel,
  type ChangeItem,
} from '../../../../../../components/ProjectChangePanel';
import {
  ProjectBudgetPanel,
  type ProjectBudgetSummary,
} from '../../../../../../components/ProjectBudgetPanel';
import { ProjectDeliveryPanel } from '../../../../../../components/ProjectDeliveryPanel';
import { ProjectLinkedSections } from '../../../../../../components/ProjectLinkedSections';
import { ProjectManageMenu } from '../../../../../../components/ProjectManageMenu';
import {
  ProjectRaidPanel,
  type RaidItem,
} from '../../../../../../components/ProjectRaidPanel';
import {
  ProjectStakeholdersPanel,
  type Stakeholder,
} from '../../../../../../components/ProjectStakeholdersPanel';
import {
  Badge,
  buttonClassName,
  Page,
  PageHeader,
  Panel,
} from '../../../../../../components/ui';
import { cn } from '../../../../../../lib/cn';
import {
  projectDeliveryRag,
  type ProjectRagStatus,
} from '../../../../../../lib/delivery-schedule';
import {
  computeChangeRag,
  computeRiskRag,
  worstProjectRag,
} from '../../../../../../lib/project-health';
import { apiFetch, requireSession } from '../../../../../../lib/session';

function ragBadgeTone(
  rag: ProjectRagStatus,
): 'success' | 'warn' | 'danger' {
  if (rag === 'red') return 'danger';
  if (rag === 'amber') return 'warn';
  return 'success';
}

function ragNavClass(rag: ProjectRagStatus | null): string {
  if (rag === 'red') {
    return 'border-danger/35 bg-danger-soft text-danger hover:bg-danger-soft';
  }
  if (rag === 'amber') {
    return 'border-warn/40 bg-warn-soft text-warn hover:bg-warn-soft';
  }
  if (rag === 'green') {
    return 'border-accent/35 bg-accent-soft text-accent hover:bg-accent-soft';
  }
  return '';
}

export const dynamic = 'force-dynamic';

type Workspace = { id: string; slug: string; name: string };
type Project = {
  id: string;
  name: string;
  slug: string;
  status: string;
  summary: string | null;
  description: string | null;
  tags: Array<{ name: string }>;
  startDate: string | null;
  endDate: string | null;
  currency: string;
  initialBudget: string | null;
  approvedBudget: string | null;
  charterRecordId: string | null;
  charterRecord: {
    id: string;
    title: string;
    slug: string;
    recordType: string;
  } | null;
  initialPlanRecordId: string | null;
  initialPlanRecord: {
    id: string;
    title: string;
    slug: string;
    recordType: string;
  } | null;
  definitionOfDone?: string | null;
  keyPrefix?: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};
type System = {
  id: string;
  name: string;
  slug: string;
  status: string;
  projectId: string | null;
  summary: string | null;
  tags: Array<{ name: string }>;
  updatedAt: string;
};
type KnowledgeRecordSummary = {
  id: string;
  title: string;
  slug: string;
  recordType: string;
  humanKey?: string | null;
  lifecycleStatus: string;
  language?: string | null;
  translationGroupId?: string | null;
  summary: string | null;
  updatedAt: string;
};

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ slug: string; projectSlug: string }>;
}) {
  const session = await requireSession();
  const t = await getTranslations('projects');
  const tArchive = await getTranslations('archive');
  const tCommon = await getTranslations('common');
  const tBaseline = await getTranslations('baseline');
  const tStakeholders = await getTranslations('stakeholders');
  const tDelivery = await getTranslations('delivery');
  const tBudget = await getTranslations('budget');
  const tRaid = await getTranslations('raid');
  const tChange = await getTranslations('changes');
  const { slug, projectSlug } = await params;

  const workspacesResponse = await apiFetch('/api/v1/workspaces');
  if (!workspacesResponse.ok) {
    notFound();
  }
  const workspacesPayload = (await workspacesResponse.json()) as { workspaces: Workspace[] };
  const workspace = workspacesPayload.workspaces.find((item) => item.slug === slug);
  if (!workspace) {
    notFound();
  }

  const projectsResponse = await apiFetch(
    `/api/v1/projects?workspaceId=${workspace.id}&includeArchived=true`,
  );
  if (!projectsResponse.ok) {
    notFound();
  }
  const projectsPayload = (await projectsResponse.json()) as { projects: Project[] };
  const projectSummary = projectsPayload.projects.find((item) => item.slug === projectSlug);
  if (!projectSummary) {
    notFound();
  }

  const detailResponse = await apiFetch(`/api/v1/projects/${projectSummary.id}`);
  if (!detailResponse.ok) {
    notFound();
  }
  const detailPayload = (await detailResponse.json()) as { project: Project };
  const project = detailPayload.project;
  const isArchived = Boolean(project.archivedAt);

  const canMutate =
    session.user.isSystemAdmin ||
    session.memberships.some(
      (membership) =>
        membership.workspaceId === workspace.id &&
        (membership.role === 'workspace_admin' || membership.role === 'maintainer'),
    );
  const canPurge =
    session.user.isSystemAdmin ||
    session.memberships.some(
      (membership) =>
        membership.workspaceId === workspace.id &&
        membership.role === 'workspace_admin',
    );

  const [
    systemsResponse,
    recordsResponse,
    milestonesResponse,
    tasksResponse,
    epicsResponse,
    storiesResponse,
    membersResponse,
    stakeholdersResponse,
    raidResponse,
    initialStakeholdersResponse,
    changesResponse,
    budgetResponse,
  ] = await Promise.all([
    apiFetch(`/api/v1/systems?workspaceId=${workspace.id}&projectId=${project.id}`),
    apiFetch(
      `/api/v1/knowledge-records?workspaceId=${workspace.id}&projectId=${project.id}`,
    ),
    apiFetch(`/api/v1/projects/${project.id}/milestones`),
    apiFetch(`/api/v1/projects/${project.id}/tasks`),
    apiFetch(`/api/v1/projects/${project.id}/epics`),
    apiFetch(`/api/v1/projects/${project.id}/user-stories`),
    apiFetch(`/api/v1/workspaces/${workspace.id}/members`),
    apiFetch(`/api/v1/projects/${project.id}/stakeholders`),
    apiFetch(`/api/v1/projects/${project.id}/raid-items`),
    apiFetch(`/api/v1/projects/${project.id}/initial-stakeholders`),
    apiFetch(`/api/v1/projects/${project.id}/change-items`),
    apiFetch(`/api/v1/projects/${project.id}/budget-summary`),
  ]);
  const systems = systemsResponse.ok
    ? ((await systemsResponse.json()) as { systems: System[] }).systems
    : [];
  const knowledgeRecords = recordsResponse.ok
    ? ((await recordsResponse.json()) as { knowledgeRecords: KnowledgeRecordSummary[] })
        .knowledgeRecords
    : [];
  const milestones = milestonesResponse.ok
    ? ((await milestonesResponse.json()) as {
        milestones: Array<{
          id: string;
          title: string;
          description: string | null;
          status: string;
          startDate: string | null;
          targetDate: string | null;
          sortOrder: number;
          createdAt?: string;
          updatedAt?: string;
        }>;
      }).milestones
    : [];
  const tasks = tasksResponse.ok
    ? ((await tasksResponse.json()) as {
        tasks: Array<{
          id: string;
          title: string;
          description: string | null;
          status: string;
          dueDate: string | null;
          forecastHours: string | null;
          actualHours: string | null;
          milestoneId: string | null;
          userStoryId: string | null;
          userStoryTitle: string | null;
          epicId: string | null;
          epicTitle: string | null;
          currentOwnerUserId: string | null;
          currentOwner: {
            userId: string;
            displayName: string;
            email: string;
          } | null;
          createdAt?: string;
          updatedAt?: string;
          raci: Array<{
            userId: string;
            displayName: string;
            email: string;
            role: 'R' | 'A' | 'C' | 'I';
          }>;
        }>;
      }).tasks
    : [];
  const epics = epicsResponse.ok
    ? ((await epicsResponse.json()) as {
        epics: Array<{
          id: string;
          title: string;
          description: string | null;
          status: string;
          startDate: string | null;
          endDate: string | null;
          sortOrder: number;
          createdAt?: string;
          updatedAt?: string;
        }>;
      }).epics
    : [];
  const stories = storiesResponse.ok
    ? ((await storiesResponse.json()) as {
        userStories: Array<{
          id: string;
          epicId: string;
          title: string;
          description: string | null;
          status: string;
          startDate: string | null;
          endDate: string | null;
          sortOrder: number;
          createdAt?: string;
          updatedAt?: string;
        }>;
      }).userStories
    : [];
  const members = membersResponse.ok
    ? (
        (await membersResponse.json()) as {
          members: Array<{
            userId: string;
            displayName: string;
            fullName?: string | null;
            email: string;
          }>;
        }
      ).members.map((row) => ({
        userId: row.userId,
        displayName: row.displayName || row.email || row.userId,
        fullName: row.fullName ?? null,
        email: row.email || '',
      }))
    : [];
  const stakeholders = stakeholdersResponse.ok
    ? ((await stakeholdersResponse.json()) as { stakeholders: Stakeholder[] })
        .stakeholders
    : [];
  const raidItems = raidResponse.ok
    ? ((await raidResponse.json()) as { raidItems: RaidItem[] }).raidItems
    : [];
  const initialStakeholders = initialStakeholdersResponse.ok
    ? (
        (await initialStakeholdersResponse.json()) as {
          initialStakeholders: InitialStakeholder[];
        }
      ).initialStakeholders
    : [];
  const changeItems = changesResponse.ok
    ? ((await changesResponse.json()) as { changeItems: ChangeItem[] })
        .changeItems
    : [];
  const budgetSummary = budgetResponse.ok
    ? ((await budgetResponse.json()) as { budget: ProjectBudgetSummary }).budget
    : null;

  const timelineRag = projectDeliveryRag([
    ...milestones.map((row) => ({ status: row.status, date: row.targetDate })),
    ...tasks.map((row) => ({ status: row.status, date: row.dueDate })),
  ]);
  const riskRag = computeRiskRag(raidItems);
  const financialRag = budgetSummary?.financialRag ?? 'green';
  const changeRag = computeChangeRag(changeItems);
  const overallRag = worstProjectRag([timelineRag, riskRag, financialRag]);

  const sectionNav: Array<{
    id: string;
    label: string;
    rag: ProjectRagStatus | null;
  }> = [
    { id: 'project-overview', label: t('navOverview'), rag: null },
    { id: 'project-baseline', label: tBaseline('title'), rag: null },
    { id: 'project-stakeholders', label: tStakeholders('title'), rag: null },
    { id: 'project-delivery', label: tDelivery('title'), rag: timelineRag },
    { id: 'project-budget', label: tBudget('title'), rag: financialRag },
    { id: 'project-raid', label: tRaid('title'), rag: riskRag },
    { id: 'project-change', label: tChange('title'), rag: changeRag },
    { id: 'project-systems', label: t('linkedSystems'), rag: null },
    { id: 'project-knowledge', label: t('linkedKnowledge'), rag: null },
  ];

  const ratePeople = stakeholders
    .filter((row) => row.kind === 'person' && row.userId)
    .map((row) => ({
      userId: row.userId!,
      displayName: row.displayName,
      hourlyRate:
        row.hourlyRate == null || row.hourlyRate === ''
          ? null
          : Number(row.hourlyRate),
    }))
    .map((row) => ({
      ...row,
      hourlyRate:
        row.hourlyRate != null && Number.isFinite(row.hourlyRate)
          ? row.hourlyRate
          : null,
    }));

  return (
    <Page wide>
      <PageHeader
        eyebrow={
          <>
            <Link
              href={`/workspaces/${workspace.slug}`}
              className="text-brand no-underline hover:text-brand-hover"
            >
              {workspace.name}
            </Link>
            {' / '}
            {t('breadcrumb')}
          </>
        }
        title={
          <span className="inline-flex flex-wrap items-center gap-3">
            <span>{project.name}</span>
            <Badge
              tone={ragBadgeTone(overallRag)}
              title={[
                `${t('ragTimeline')}: ${t(`rag.${timelineRag}`)}`,
                `${t('ragRisks')}: ${t(`rag.${riskRag}`)}`,
                `${t('ragFinancials')}: ${t(`rag.${financialRag}`)}`,
              ].join(' · ')}
              aria-label={`${t('ragOverall')}: ${t(`rag.${overallRag}`)}`}
            >
              {t('ragOverall')}: {t(`rag.${overallRag}`)}
            </Badge>
          </span>
        }
        nav={
          <nav
            aria-label={t('sectionNav')}
            className="flex flex-wrap items-center gap-2"
          >
            {sectionNav.map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                className={cn(
                  buttonClassName('secondary', '!px-2.5 !py-1 text-xs'),
                  ragNavClass(item.rag),
                )}
                title={
                  item.rag ? `${item.label}: ${t(`rag.${item.rag}`)}` : undefined
                }
                aria-label={
                  item.rag
                    ? `${item.label}: ${t(`rag.${item.rag}`)}`
                    : item.label
                }
              >
                {item.label}
              </a>
            ))}
          </nav>
        }
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <span>{project.slug}</span>
            <Badge tone="brand">{project.status}</Badge>
            {isArchived ? <Badge tone="warn">{tArchive('archivedBadge')}</Badge> : null}
          </span>
        }
        actions={
          <ProjectManageMenu
            workspaceSlug={workspace.slug}
            project={project}
            canMutate={canMutate}
            canPurge={canPurge}
            knowledgeRecords={knowledgeRecords}
          />
        }
      />

      <Panel id="project-overview" className="mb-8 scroll-mt-6">
        <h2 className="mt-0 mb-3 text-xl font-semibold tracking-tight text-ink">
          {t('navOverview')}
        </h2>
        <p className="mt-0 mb-3 text-ink-muted">{project.summary || tCommon('noSummary')}</p>
        <p className="m-0 text-ink-muted">{project.description || tCommon('noDescription')}</p>
        {project.tags.length > 0 ? (
          <p className="mt-3 mb-0 text-xs text-ink-muted">
            {tCommon('tagsList', { tags: project.tags.map((tag) => tag.name).join(', ') })}
          </p>
        ) : null}
      </Panel>

      <ProjectBaselinePanel
        projectId={project.id}
        workspaceSlug={workspace.slug}
        canMutate={canMutate && !isArchived}
        project={project}
        initialStakeholders={initialStakeholders}
        members={members}
        knowledgeRecords={knowledgeRecords}
      />

      <ProjectStakeholdersPanel
        projectId={project.id}
        projectName={project.name}
        canMutate={canMutate && !isArchived}
        initialStakeholders={stakeholders}
        members={members}
        currency={project.currency ?? 'EUR'}
      />

      <ProjectDeliveryPanel
        projectId={project.id}
        projectName={project.name}
        workspaceId={workspace.id}
        canMutate={canMutate && !isArchived}
        projectStartDate={project.startDate}
        projectEndDate={project.endDate}
        definitionOfDone={project.definitionOfDone ?? null}
        initialEpics={epics}
        initialStories={stories}
        initialMilestones={milestones}
        initialTasks={tasks}
        members={members}
        currency={project.currency ?? 'EUR'}
        ratePeople={ratePeople}
      />

      <ProjectBudgetPanel
        projectId={project.id}
        canMutate={canMutate && !isArchived}
        initialSummary={budgetSummary}
      />

      <ProjectRaidPanel
        projectId={project.id}
        canMutate={canMutate && !isArchived}
        initialRaidItems={raidItems}
        tasks={tasks.map((task) => ({
          id: task.id,
          title: task.title,
          status: task.status,
        }))}
        members={members}
      />

      <ProjectChangePanel
        projectId={project.id}
        canMutate={canMutate && !isArchived}
        initialChangeItems={changeItems}
        members={members}
        deliveryOptions={[
          ...epics.map((epic) => ({
            entityType: 'epic' as const,
            entityId: epic.id,
            title: epic.title,
          })),
          ...stories.map((story) => ({
            entityType: 'user_story' as const,
            entityId: story.id,
            title: story.title,
          })),
          ...milestones.map((milestone) => ({
            entityType: 'milestone' as const,
            entityId: milestone.id,
            title: milestone.title,
          })),
          ...tasks.map((task) => ({
            entityType: 'task' as const,
            entityId: task.id,
            title: task.title,
          })),
        ]}
        knowledgeRecords={knowledgeRecords}
      />

      <ProjectLinkedSections
        workspaceSlug={workspace.slug}
        projectId={project.id}
        systems={systems}
        records={knowledgeRecords}
        canMutate={canMutate && !isArchived}
      />
    </Page>
  );
}
