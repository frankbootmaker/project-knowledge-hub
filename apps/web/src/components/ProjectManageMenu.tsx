'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArchiveEntityButton } from './ArchiveEntityButton';
import { PurgeEntityButton } from './PurgeEntityButton';
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
import { useProjectReportPreview } from '../lib/use-project-report-preview';

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

type Section = 'menu' | 'details' | 'edit' | 'archive' | 'delete' | 'reports' | 'move' | 'move-review';

export type MoveWorkspaceOption = {
  id: string;
  name: string;
  slug: string;
  organizationId: string;
  organizationName: string;
};

type MoveConflict = {
  type: string;
  entity?: string;
  slug?: string;
  keyPrefix?: string;
  displayName?: string;
  name?: string;
  owner?: string;
  repo?: string;
  branch?: string;
};

type MovePreview = {
  crossOrganization: boolean;
  conflicts: MoveConflict[];
  counts: {
    systems: number;
    knowledgeRecords: number;
    gitConnections: number;
    conversationImports: number;
    documentImports: number;
  };
  tagRemaps: Array<{ name: string; reused: boolean }>;
  project: { slug: string; workspaceSlug: string };
};

export function ProjectManageMenu(props: {
  workspaceSlug: string;
  project: ProjectManageDetails;
  canMutate: boolean;
  canPurge: boolean;
  knowledgeRecords?: KnowledgeOption[];
  moveTargets?: MoveWorkspaceOption[];
}) {
  const t = useTranslations('projects');
  const tBaseline = useTranslations('baseline');
  const tCommon = useTranslations('common');
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
  const [moveTargetId, setMoveTargetId] = useState('');
  const [movePreview, setMovePreview] = useState<MovePreview | null>(null);
  const [confirmOrg, setConfirmOrg] = useState(false);
  const { openReport, reportLoading, reportViewer } = useProjectReportPreview(
    props.project,
    {
      onOpen: () => {
        setOpen(false);
        setSection('menu');
      },
    },
  );

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

  function sectionTitle(): string {
    if (section === 'menu') return t('manageTitle');
    if (section === 'details') return t('manageDetails');
    if (section === 'edit') return t('manageEdit');
    if (section === 'reports') return t('manageReports');
    if (section === 'move' || section === 'move-review') return t('moveTitle');
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

  function describeConflict(conflict: MoveConflict): string {
    if (conflict.type === 'slug') {
      return t('moveConflictSlug', {
        entity: conflict.entity ?? 'item',
        slug: conflict.slug ?? '',
      });
    }
    if (conflict.type === 'key_prefix') {
      return t('moveConflictPrefix', { prefix: conflict.keyPrefix ?? '' });
    }
    if (conflict.type === 'membership') {
      return t('moveConflictMember', { name: conflict.displayName ?? '' });
    }
    if (conflict.type === 'shared_system') {
      return t('moveConflictSystem', { name: conflict.name ?? '' });
    }
    return t('moveConflictGit', {
      owner: conflict.owner ?? '',
      repo: conflict.repo ?? '',
      branch: conflict.branch ?? '',
    });
  }

  async function reviewMove() {
    if (!moveTargetId) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/projects/${props.project.id}/move`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Origin: window.location.origin,
        },
        body: JSON.stringify({ targetWorkspaceId: moveTargetId, dryRun: true }),
      });
      const payload = (await response.json()) as {
        move?: MovePreview;
        error?: { message?: string };
      };
      if (!response.ok || !payload.move) {
        throw new Error(payload.error?.message ?? t('moveFailed'));
      }
      setMovePreview(payload.move);
      setConfirmOrg(false);
      setSection('move-review');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('moveFailed'));
    } finally {
      setPending(false);
    }
  }

  async function commitMove() {
    if (!moveTargetId || !movePreview) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/projects/${props.project.id}/move`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Origin: window.location.origin,
        },
        body: JSON.stringify({
          targetWorkspaceId: moveTargetId,
          confirmCrossOrganization: movePreview.crossOrganization ? confirmOrg : undefined,
        }),
      });
      const payload = (await response.json()) as {
        move?: MovePreview;
        error?: { message?: string };
      };
      if (!response.ok || !payload.move) {
        throw new Error(payload.error?.message ?? t('moveFailed'));
      }
      pushToast(t('moveSuccess'));
      router.push(
        `/workspaces/${payload.move.project.workspaceSlug}/projects/${payload.move.project.slug}`,
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('moveFailed'));
    } finally {
      setPending(false);
    }
  }

  const moveGroups = new Map<
    string,
    { id: string; name: string; workspaces: MoveWorkspaceOption[] }
  >();
  for (const workspace of props.moveTargets ?? []) {
    const group = moveGroups.get(workspace.organizationId) ?? {
      id: workspace.organizationId,
      name: workspace.organizationName,
      workspaces: [],
    };
    group.workspaces.push(workspace);
    moveGroups.set(workspace.organizationId, group);
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
                title={t('manageMove')}
                hint={t('manageMoveHint')}
                onClick={() => {
                  setError(null);
                  setMovePreview(null);
                  setSection('move');
                }}
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
            <div className="kh-ops-form-grid">
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

        {section === 'move' ? (
          <div className="grid gap-4">
            {(props.moveTargets ?? []).length === 0 ? (
              <p className="m-0 text-sm text-ink-muted">{t('moveNoDestinations')}</p>
            ) : (
              <Field label={t('moveDestination')}>
                <Select
                  value={moveTargetId}
                  onChange={(event) => setMoveTargetId(event.target.value)}
                >
                  <option value="">{tCommon('none')}</option>
                  {[...moveGroups.values()].map((group) => (
                    <optgroup key={group.id} label={group.name}>
                      {group.workspaces.map((workspace) => (
                        <option key={workspace.id} value={workspace.id}>
                          {workspace.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </Select>
              </Field>
            )}
            {error ? <ErrorText>{error}</ErrorText> : null}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={pending || !moveTargetId}
                onClick={() => void reviewMove()}
              >
                {pending ? tCommon('saving') : t('moveContinue')}
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

        {section === 'move-review' && movePreview ? (
          <div className="grid gap-4">
            {movePreview.conflicts.length > 0 ? (
              <>
                <p className="m-0 text-sm text-ink-muted">{t('moveConflicts')}</p>
                <ul className="m-0 grid list-disc gap-1 pl-5 text-sm">
                  {movePreview.conflicts.map((conflict, index) => (
                    <li key={`${conflict.type}-${index}`}>{describeConflict(conflict)}</li>
                  ))}
                </ul>
              </>
            ) : (
              <>
                <p className="m-0 text-sm text-ink-muted">{t('moveSummary')}</p>
                <p className="m-0 text-sm">
                  {t('moveCounts', {
                    systems: movePreview.counts.systems,
                    records: movePreview.counts.knowledgeRecords,
                    git: movePreview.counts.gitConnections,
                    conversations: movePreview.counts.conversationImports,
                    documents: movePreview.counts.documentImports,
                  })}
                </p>
                {movePreview.tagRemaps.length > 0 ? (
                  <ul className="m-0 grid list-disc gap-1 pl-5 text-sm">
                    {movePreview.tagRemaps.map((tag) => (
                      <li key={tag.name}>
                        {tag.reused
                          ? t('moveTagReused', { name: tag.name })
                          : t('moveTagRemap', { name: tag.name })}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {movePreview.crossOrganization ? (
                  <label className="kh-ops-scope-check">
                    <input
                      type="checkbox"
                      checked={confirmOrg}
                      onChange={(event) => setConfirmOrg(event.target.checked)}
                    />
                    <span>{t('moveConfirmOrg')}</span>
                  </label>
                ) : null}
              </>
            )}
            {error ? <ErrorText>{error}</ErrorText> : null}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={
                  pending ||
                  movePreview.conflicts.length > 0 ||
                  (movePreview.crossOrganization && !confirmOrg)
                }
                onClick={() => void commitMove()}
              >
                {pending ? tCommon('saving') : t('moveButton')}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={pending}
                onClick={() => {
                  setError(null);
                  setSection('move');
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

      {reportViewer}
    </>
  );
}
