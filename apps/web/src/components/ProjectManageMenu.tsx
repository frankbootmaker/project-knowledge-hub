'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArchiveEntityButton } from './ArchiveEntityButton';
import { PurgeEntityButton } from './PurgeEntityButton';
import {
  ProjectReportViewer,
  type ProjectReportKind,
} from './ProjectReportViewer';
import {
  ManageDetailRow,
  ManageMenuItem,
  ManageToolbar,
} from './manage-menu-shared';
import {
  Button,
  ErrorText,
  Field,
  Input,
  Modal,
  Select,
  Textarea,
  useToast,
} from './ui';
import { projectDeliveryRag } from '../lib/delivery-schedule';
import {
  buildDeliveryStatusReport,
  buildProjectStatusReport,
  buildStakeholdersReport,
  fetchProjectReportData,
} from '../lib/project-reports';

export type ProjectManageDetails = {
  id: string;
  name: string;
  slug: string;
  status: string;
  summary: string | null;
  description: string | null;
  tags: Array<{ name: string }>;
  startDate?: string | null;
  endDate?: string | null;
  charterRecordId?: string | null;
  charterRecord?: {
    id: string;
    title: string;
    slug: string;
    recordType: string;
  } | null;
  initialPlanRecordId?: string | null;
  initialPlanRecord?: {
    id: string;
    title: string;
    slug: string;
    recordType: string;
  } | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

type KnowledgeOption = {
  id: string;
  title: string;
  slug: string;
  recordType: string;
};

type Section = 'menu' | 'details' | 'edit' | 'archive' | 'delete' | 'reports';

export function ProjectManageMenu(props: {
  workspaceSlug: string;
  project: ProjectManageDetails;
  canMutate: boolean;
  canPurge: boolean;
  knowledgeRecords?: KnowledgeOption[];
}) {
  const t = useTranslations('projects');
  const tBaseline = useTranslations('baseline');
  const tCommon = useTranslations('common');
  const tStakeholders = useTranslations('stakeholders');
  const tDelivery = useTranslations('delivery');
  const router = useRouter();
  const { pushToast } = useToast();
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<Section>('menu');
  const [name, setName] = useState(props.project.name);
  const [summary, setSummary] = useState(props.project.summary ?? '');
  const [description, setDescription] = useState(props.project.description ?? '');
  const [status, setStatus] = useState(props.project.status);
  const [tags, setTags] = useState(
    props.project.tags.map((tag) => tag.name).join(', '),
  );
  const [startDate, setStartDate] = useState(props.project.startDate ?? '');
  const [endDate, setEndDate] = useState(props.project.endDate ?? '');
  const [charterRecordId, setCharterRecordId] = useState(
    props.project.charterRecordId ?? '',
  );
  const [initialPlanRecordId, setInitialPlanRecordId] = useState(
    props.project.initialPlanRecordId ?? '',
  );
  const knowledgeRecords = props.knowledgeRecords ?? [];
  const charterOptions = knowledgeRecords.filter(
    (row) => row.recordType === 'project-charter',
  );
  const planOptions = knowledgeRecords.filter(
    (row) => row.recordType === 'plan',
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportKind, setReportKind] = useState<ProjectReportKind | null>(null);
  const [reportTitle, setReportTitle] = useState('');
  const [reportMarkdown, setReportMarkdown] = useState('');
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  const archived = Boolean(props.project.archivedAt);
  const redirectParent = `/workspaces/${props.workspaceSlug}`;

  useEffect(() => {
    setName(props.project.name);
    setSummary(props.project.summary ?? '');
    setDescription(props.project.description ?? '');
    setStatus(props.project.status);
    setTags(props.project.tags.map((tag) => tag.name).join(', '));
    setStartDate(props.project.startDate ?? '');
    setEndDate(props.project.endDate ?? '');
    setCharterRecordId(props.project.charterRecordId ?? '');
    setInitialPlanRecordId(props.project.initialPlanRecordId ?? '');
  }, [props.project]);

  function close() {
    setOpen(false);
    setSection('menu');
    setError(null);
  }

  function closeReport() {
    setReportOpen(false);
    setReportKind(null);
    setReportTitle('');
    setReportMarkdown('');
    setReportError(null);
    setReportLoading(false);
  }

  function sectionTitle(): string {
    if (section === 'menu') return t('manageTitle');
    if (section === 'details') return t('manageDetails');
    if (section === 'edit') return t('manageEdit');
    if (section === 'reports') return t('manageReports');
    if (section === 'delete') return t('manageDelete');
    return archived ? t('manageRestore') : t('manageArchive');
  }

  async function saveEdit() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/projects/${props.project.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Origin: window.location.origin,
        },
        body: JSON.stringify({
          name: name.trim(),
          summary: summary.trim() || null,
          description: description.trim() || null,
          status,
          tags: tags
            .split(',')
            .map((tag) => tag.trim())
            .filter(Boolean),
          startDate: startDate || null,
          endDate: endDate || null,
          charterRecordId: charterRecordId || null,
          initialPlanRecordId: initialPlanRecordId || null,
        }),
      });
      const payload = (await response.json()) as {
        project?: { slug: string };
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? t('failedUpdate'));
      }
      pushToast(t('updated'));
      const nextSlug = payload.project?.slug ?? props.project.slug;
      if (nextSlug !== props.project.slug) {
        router.push(`/workspaces/${props.workspaceSlug}/projects/${nextSlug}`);
      }
      router.refresh();
      setSection('menu');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('failedUpdate'));
    } finally {
      setPending(false);
    }
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
    setOpen(false);
    setSection('menu');

    try {
      const data = await fetchProjectReportData(props.project.id);
      const rag = projectDeliveryRag([
        ...data.milestones.map((row) => ({
          status: row.status,
          date: row.targetDate,
        })),
        ...data.tasks.map((row) => ({ status: row.status, date: row.dueDate })),
      ]);
      const ragValue = t(`rag.${rag}`);

      let markdown = '';
      if (kind === 'delivery') {
        markdown = buildDeliveryStatusReport({
          projectName: props.project.name,
          projectSlug: props.project.slug,
          projectStatus: props.project.status,
          milestones: data.milestones,
          tasks: data.tasks,
          labels: {
            title: t('reportDeliveryTitle'),
            generated: t('reportGenerated'),
            rag: t('ragLabel'),
            ragValue,
            milestones: tDelivery('kindMilestone'),
            tasks: tDelivery('kindTask'),
            none: tCommon('none'),
          },
        });
      } else if (kind === 'stakeholders') {
        markdown = buildStakeholdersReport({
          projectName: props.project.name,
          projectSlug: props.project.slug,
          stakeholders: data.stakeholders,
          labels: {
            title: t('reportStakeholdersTitle'),
            generated: t('reportGenerated'),
            people: t('reportPeople'),
            aiAssistants: tStakeholders('kindAiAssistant'),
            none: tCommon('none'),
            reportsTo: tStakeholders('reportsTo'),
          },
        });
      } else {
        markdown = buildProjectStatusReport({
          projectName: props.project.name,
          projectSlug: props.project.slug,
          projectStatus: props.project.status,
          summary: props.project.summary,
          milestones: data.milestones,
          tasks: data.tasks,
          stakeholders: data.stakeholders,
          labels: {
            statusTitle: t('reportStatusTitle'),
            deliveryTitle: t('reportDeliveryTitle'),
            stakeholdersTitle: t('reportStakeholdersTitle'),
            generated: t('reportGenerated'),
            rag: t('ragLabel'),
            ragValue,
            milestones: tDelivery('kindMilestone'),
            tasks: tDelivery('kindTask'),
            people: t('reportPeople'),
            aiAssistants: tStakeholders('kindAiAssistant'),
            none: tCommon('none'),
            reportsTo: tStakeholders('reportsTo'),
            summary: tCommon('summary'),
          },
        });
      }

      setReportMarkdown(markdown);
    } catch (err) {
      setReportError(err instanceof Error ? err.message : t('reportFailed'));
    } finally {
      setReportLoading(false);
    }
  }

  return (
    <>
      <ManageToolbar>
        <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
          {t('manage')}
        </Button>
      </ManageToolbar>

      <Modal
        open={open}
        onClose={close}
        title={sectionTitle()}
        description={
          section === 'menu'
            ? t('manageDescription')
            : section === 'reports'
              ? t('manageReportsHint')
              : undefined
        }
        size="md"
      >
        {section === 'menu' ? (
          <ul className="m-0 grid list-none gap-2 p-0">
            <ManageMenuItem
              title={t('manageDetails')}
              hint={t('manageDetailsHint')}
              onClick={() => setSection('details')}
            />
            <ManageMenuItem
              title={t('manageReports')}
              hint={t('manageReportsHint')}
              onClick={() => setSection('reports')}
            />
            {props.canMutate && !archived ? (
              <ManageMenuItem
                title={t('manageEdit')}
                hint={t('manageEditHintBaseline')}
                onClick={() => setSection('edit')}
              />
            ) : null}
            {props.canMutate ? (
              <ManageMenuItem
                title={archived ? t('manageRestore') : t('manageArchive')}
                hint={
                  archived ? t('manageRestoreHint') : t('manageArchiveHint')
                }
                onClick={() => setSection('archive')}
              />
            ) : null}
            {props.canPurge ? (
              <ManageMenuItem
                title={t('manageDelete')}
                hint={t('manageDeleteHint')}
                onClick={() => setSection('delete')}
              />
            ) : null}
          </ul>
        ) : null}

        {section === 'reports' ? (
          <div className="grid gap-4">
            <ul className="m-0 grid list-none gap-2 p-0">
              <ManageMenuItem
                title={t('reportStatus')}
                hint={t('reportStatusHint')}
                disabled={reportLoading}
                onClick={() => void openReport('status')}
              />
              <ManageMenuItem
                title={t('reportDelivery')}
                hint={t('reportDeliveryHint')}
                disabled={reportLoading}
                onClick={() => void openReport('delivery')}
              />
              <ManageMenuItem
                title={t('reportStakeholders')}
                hint={t('reportStakeholdersHint')}
                disabled={reportLoading}
                onClick={() => void openReport('stakeholders')}
              />
            </ul>
            {error ? <ErrorText>{error}</ErrorText> : null}
            <Button
              type="button"
              variant="secondary"
              disabled={reportLoading}
              onClick={() => {
                setError(null);
                setSection('menu');
              }}
            >
              {tCommon('back')}
            </Button>
          </div>
        ) : null}

        {section === 'details' ? (
          <div className="grid gap-4">
            <dl className="m-0 grid gap-3">
              <ManageDetailRow label={t('detailsId')} value={props.project.id} mono />
              <ManageDetailRow label={t('detailsSlug')} value={props.project.slug} mono />
              <ManageDetailRow label={tCommon('status')} value={props.project.status} />
              <ManageDetailRow
                label={tCommon('tags')}
                value={
                  props.project.tags.length > 0
                    ? props.project.tags.map((tag) => tag.name).join(', ')
                    : tCommon('none')
                }
              />
              <ManageDetailRow
                label={tBaseline('startDate')}
                value={props.project.startDate || tCommon('none')}
              />
              <ManageDetailRow
                label={tBaseline('endDate')}
                value={props.project.endDate || tCommon('none')}
              />
              <ManageDetailRow
                label={tBaseline('charter')}
                value={props.project.charterRecord?.title || tCommon('none')}
              />
              <ManageDetailRow
                label={tBaseline('initialPlan')}
                value={
                  props.project.initialPlanRecord?.title || tCommon('none')
                }
              />
              <ManageDetailRow
                label={t('detailsCreated')}
                value={new Date(props.project.createdAt).toLocaleString()}
              />
              <ManageDetailRow
                label={tCommon('updated')}
                value={new Date(props.project.updatedAt).toLocaleString()}
              />
            </dl>
            <Button type="button" variant="secondary" onClick={() => setSection('menu')}>
              {tCommon('back')}
            </Button>
          </div>
        ) : null}

        {section === 'edit' ? (
          <div className="grid gap-4">
            <Field label={tCommon('name')}>
              <Input value={name} onChange={(e) => setName(e.target.value)} required />
            </Field>
            <Field label={tCommon('summary')}>
              <Input value={summary} onChange={(e) => setSummary(e.target.value)} />
            </Field>
            <Field label={tCommon('description')}>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
              />
            </Field>
            <Field label={tCommon('status')}>
              <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="idea">idea</option>
                <option value="planned">planned</option>
                <option value="active">active</option>
                <option value="maintenance">maintenance</option>
                <option value="paused">paused</option>
                <option value="completed">completed</option>
                <option value="archived">archived</option>
              </Select>
            </Field>
            <Field label={tCommon('tagsHint')}>
              <Input value={tags} onChange={(e) => setTags(e.target.value)} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={tBaseline('startDate')}>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </Field>
              <Field label={tBaseline('endDate')}>
                <Input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </Field>
            </div>
            <Field label={tBaseline('charter')}>
              <Select
                value={charterRecordId}
                onChange={(e) => setCharterRecordId(e.target.value)}
              >
                <option value="">{tCommon('none')}</option>
                {charterOptions.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.title}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={tBaseline('initialPlan')}>
              <Select
                value={initialPlanRecordId}
                onChange={(e) => setInitialPlanRecordId(e.target.value)}
              >
                <option value="">{tCommon('none')}</option>
                {planOptions.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.title}
                  </option>
                ))}
              </Select>
            </Field>
            {error ? <ErrorText>{error}</ErrorText> : null}
            <div className="flex flex-wrap gap-2">
              <Button type="button" disabled={pending} onClick={() => void saveEdit()}>
                {pending ? tCommon('saving') : tCommon('save')}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={pending}
                onClick={() => {
                  setError(null);
                  setSection('menu');
                }}
              >
                {tCommon('back')}
              </Button>
            </div>
          </div>
        ) : null}

        {section === 'archive' ? (
          <div className="grid gap-4">
            <p className="m-0 text-sm text-ink-muted">
              {archived ? t('manageRestoreHint') : t('manageArchiveHint')}
            </p>
            <ArchiveEntityButton
              kind="project"
              entityId={props.project.id}
              entityName={props.project.name}
              archived={archived}
              redirectOnArchive={redirectParent}
            />
            <Button type="button" variant="secondary" onClick={() => setSection('menu')}>
              {tCommon('back')}
            </Button>
          </div>
        ) : null}

        {section === 'delete' ? (
          <div className="grid gap-4">
            <p className="m-0 text-sm text-ink-muted">{t('manageDeleteHint')}</p>
            <PurgeEntityButton
              kind="project"
              entityId={props.project.id}
              entityName={props.project.name}
              redirectOnPurge={redirectParent}
            />
            <Button type="button" variant="secondary" onClick={() => setSection('menu')}>
              {tCommon('back')}
            </Button>
          </div>
        ) : null}
      </Modal>

      <ProjectReportViewer
        open={reportOpen}
        onClose={closeReport}
        projectName={props.project.name}
        projectId={props.project.id}
        kind={reportKind}
        title={reportTitle}
        markdown={reportMarkdown}
        loading={reportLoading}
        error={reportError}
      />
    </>
  );
}
