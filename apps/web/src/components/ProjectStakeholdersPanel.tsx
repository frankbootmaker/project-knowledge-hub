'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  CatalogueSection,
  type CatalogueListItem,
} from './CatalogueSection';
import { CollapsibleSection } from './CollapsibleSection';
import { ProjectStakeholdersOrgChart } from './ProjectStakeholdersOrgChart';
import {
  Badge,
  Button,
  ErrorText,
  Field,
  Input,
  Modal,
  Select,
  useToast,
} from './ui';
import { cn } from '../lib/cn';

export type Stakeholder = {
  kind: 'person' | 'ai_assistant';
  id: string;
  userId: string | null;
  systemId: string | null;
  displayName: string;
  fullName: string | null;
  email: string | null;
  projectRole: string | null;
  jobTitle: string | null;
  notes: string | null;
  reportsToUserId: string | null;
  raciRoles: string[];
  taskCount: number;
  sources: string[];
  rosterId: string | null;
  sortOrder: number;
  systemSlug: string | null;
  systemStatus: string | null;
};

type Member = {
  userId: string;
  displayName: string;
  fullName?: string | null;
  email: string;
};

const PROJECT_ROLES = [
  'sponsor',
  'owner',
  'product_owner',
  'tech_lead',
  'contributor',
  'stakeholder',
  'other',
] as const;

const VIEW_MODES = ['list', 'org'] as const;
type ViewMode = (typeof VIEW_MODES)[number];

export function ProjectStakeholdersPanel({
  projectId,
  canMutate,
  initialStakeholders,
  members,
}: {
  projectId: string;
  canMutate: boolean;
  initialStakeholders: Stakeholder[];
  members: Member[];
}) {
  const t = useTranslations('stakeholders');
  const tCommon = useTranslations('common');
  const tWorkspaces = useTranslations('workspaces');
  const router = useRouter();
  const { pushToast } = useToast();

  const [stakeholders, setStakeholders] = useState(initialStakeholders);
  useEffect(() => {
    setStakeholders(initialStakeholders);
  }, [initialStakeholders]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('list');

  const [userId, setUserId] = useState('');
  const [projectRole, setProjectRole] = useState<string>('stakeholder');
  const [jobTitle, setJobTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [reportsToUserId, setReportsToUserId] = useState('');

  const nameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of stakeholders) {
      if (row.userId) map.set(row.userId, row.displayName);
      map.set(row.id, row.displayName);
    }
    return map;
  }, [stakeholders]);

  const people = useMemo(
    () => stakeholders.filter((row) => row.kind === 'person'),
    [stakeholders],
  );

  function changeViewMode(mode: ViewMode) {
    setViewMode(mode);
  }

  const wideModalOpen = viewMode === 'org';

  function closeWideModal() {
    changeViewMode('list');
  }

  const refresh = useCallback(() => {
    router.refresh();
  }, [router]);

  async function reloadStakeholders() {
    const response = await fetch(`/api/v1/projects/${projectId}/stakeholders`);
    if (!response.ok) return;
    const payload = (await response.json()) as { stakeholders: Stakeholder[] };
    setStakeholders(payload.stakeholders);
  }

  const items: CatalogueListItem[] = useMemo(
    () =>
      stakeholders.map((row) => {
        const reportsTo = row.reportsToUserId
          ? nameById.get(row.reportsToUserId)
          : null;
        const isAi = row.kind === 'ai_assistant';
        const roleLabel = isAi
          ? t('kindAiAssistant')
          : row.projectRole
            ? t(`projectRole.${row.projectRole}`)
            : t('derivedOnly');
        const raciLabel =
          row.raciRoles.length > 0
            ? `${t('raciLabel')}: ${row.raciRoles.join(', ')}`
            : null;
        return {
          id: row.id,
          title: row.displayName,
          primaryBadge: roleLabel,
          secondaryBadge: isAi
            ? (row.systemStatus ?? undefined)
            : row.raciRoles.length > 0
              ? row.raciRoles.join(' · ')
              : undefined,
          subtitle: [
            row.email,
            isAi ? null : row.jobTitle,
            row.fullName && row.fullName !== row.displayName ? row.fullName : null,
            reportsTo
              ? `${isAi ? t('aiOwner') : t('reportsTo')}: ${reportsTo}`
              : null,
            raciLabel,
            row.taskCount > 0 ? t('taskCount', { count: row.taskCount }) : null,
            row.notes,
          ]
            .filter(Boolean)
            .join(' · '),
          searchText: [
            row.displayName,
            row.fullName ?? '',
            row.email ?? '',
            row.systemSlug ?? '',
            row.systemStatus ?? '',
            row.jobTitle ?? '',
            row.notes ?? '',
            row.projectRole ?? '',
            row.kind,
            'ai assistant',
            row.raciRoles.join(' '),
            reportsTo ?? '',
            row.sources.join(' '),
          ]
            .join(' ')
            .toLowerCase(),
          filterValue: isAi
            ? 'kind:ai_assistant'
            : row.projectRole
              ? `role:${row.projectRole}`
              : row.raciRoles[0]
                ? `raci:${row.raciRoles[0]}`
                : 'derived',
          filterLabel: roleLabel,
        };
      }),
    [stakeholders, nameById, t],
  );

  function resetCreateForm() {
    setUserId('');
    setProjectRole('stakeholder');
    setJobTitle('');
    setNotes('');
    setReportsToUserId('');
    setError(null);
  }

  function closeCreateModal() {
    setCreateOpen(false);
    resetCreateForm();
  }

  async function submitCreate() {
    if (!userId || pending) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/projects/${projectId}/stakeholders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          projectRole,
          jobTitle: jobTitle.trim() || null,
          notes: notes.trim() || null,
          reportsToUserId: reportsToUserId || null,
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          message?: string;
          error?: string;
        } | null;
        throw new Error(payload?.message || payload?.error || t('failedCreate'));
      }
      pushToast(t('created'));
      closeCreateModal();
      await reloadStakeholders();
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('failedCreate'));
    } finally {
      setPending(false);
    }
  }

  async function addDerivedToRoster(row: Stakeholder) {
    if (!canMutate || pending || row.kind !== 'person' || !row.userId) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/projects/${projectId}/stakeholders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: row.userId,
          projectRole: row.projectRole || 'contributor',
          jobTitle: row.jobTitle,
          notes: row.notes,
          reportsToUserId: row.reportsToUserId,
        }),
      });
      if (!response.ok) {
        throw new Error(t('failedCreate'));
      }
      pushToast(t('addedToRoster'));
      await reloadStakeholders();
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('failedCreate'));
    } finally {
      setPending(false);
    }
  }

  async function updateReportsTo(rosterId: string, next: string) {
    if (!canMutate || pending) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/project-stakeholders/${rosterId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportsToUserId: next || null }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          message?: string;
        } | null;
        throw new Error(payload?.message || t('failedUpdate'));
      }
      await reloadStakeholders();
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('failedUpdate'));
    } finally {
      setPending(false);
    }
  }

  function viewSwitcher(activeMode: ViewMode) {
    return (
      <div
        className="inline-flex max-w-full overflow-x-auto rounded-md border border-line p-0.5"
        role="group"
        aria-label={t('viewModeLabel')}
      >
        {VIEW_MODES.map((mode) => (
          <Button
            key={mode}
            type="button"
            variant={activeMode === mode ? 'primary' : 'secondary'}
            className={cn(
              'h-8 shrink-0 rounded-sm px-2 text-xs sm:px-2.5',
              activeMode === mode
                ? ''
                : 'border-transparent bg-transparent shadow-none',
            )}
            aria-pressed={activeMode === mode}
            onClick={() => changeViewMode(mode)}
          >
            {t(`viewMode.${mode}`)}
          </Button>
        ))}
      </div>
    );
  }

  const memberOptions = members.filter(
    (member) =>
      !people.some((row) => row.userId === member.userId && row.rosterId),
  );

  return (
    <>
      <CollapsibleSection
        storageKey={`project:${projectId}:stakeholders`}
        title={t('title')}
        defaultOpen
      >
      {error && !createOpen && !wideModalOpen ? (
        <div className="mb-3">
          <ErrorText>{error}</ErrorText>
        </div>
      ) : null}

      <CatalogueSection
        className="mb-2"
        title={t('title')}
        showTitle={false}
        items={items}
        emptyLabel={t('empty')}
        searchPlaceholder={t('searchPlaceholder')}
        filterLabel={t('filterRole')}
        filterAllLabel={tWorkspaces('sectionFilterAll')}
        createLabel={t('addItem')}
        canCreate={canMutate}
        extraActions={viewSwitcher(wideModalOpen ? 'list' : viewMode)}
        onCreate={() => {
          resetCreateForm();
          setCreateOpen(true);
        }}
        renderItem={(item) => {
          const row = stakeholders.find((entry) => entry.id === item.id);
          if (!row) return null;
          const isAi = row.kind === 'ai_assistant';
          return (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{row.displayName}</span>
                  {isAi ? (
                    <Badge tone="brand">{t('kindAiAssistant')}</Badge>
                  ) : row.projectRole ? (
                    <Badge tone="brand">{t(`projectRole.${row.projectRole}`)}</Badge>
                  ) : (
                    <Badge>{t('derivedOnly')}</Badge>
                  )}
                  {row.raciRoles.map((role) => (
                    <Badge key={role}>{role}</Badge>
                  ))}
                  {row.sources.includes('owner') ? (
                    <Badge tone="success">{t('sourceOwner')}</Badge>
                  ) : null}
                </div>
                <p className="mt-2 mb-0 text-sm break-words text-ink-muted">
                  {row.email ? (
                    <a
                      href={`mailto:${row.email}`}
                      className="text-brand no-underline hover:underline"
                    >
                      {row.email}
                    </a>
                  ) : null}
                  {!isAi && row.jobTitle ? ` · ${row.jobTitle}` : ''}
                  {row.fullName && row.fullName !== row.displayName
                    ? ` · ${row.fullName}`
                    : ''}
                  {row.reportsToUserId
                    ? ` · ${isAi ? t('aiOwner') : t('reportsTo')}: ${nameById.get(row.reportsToUserId) ?? '—'}`
                    : ''}
                  {row.taskCount > 0
                    ? ` · ${t('taskCount', { count: row.taskCount })}`
                    : ''}
                </p>
                {row.notes ? (
                  <p className="mt-1 mb-0 text-xs text-ink-muted">{row.notes}</p>
                ) : null}
              </div>
              {canMutate && !isAi ? (
                <div className="flex w-full flex-col gap-2 sm:w-auto sm:min-w-[12rem]">
                  {row.rosterId ? (
                    <Select
                      className="w-full"
                      value={row.reportsToUserId ?? ''}
                      disabled={pending}
                      aria-label={t('reportsTo')}
                      onChange={(event) =>
                        void updateReportsTo(row.rosterId!, event.target.value)
                      }
                    >
                      <option value="">{t('noReportsTo')}</option>
                      {people
                        .filter((entry) => entry.userId !== row.userId)
                        .map((entry) => (
                          <option key={entry.userId!} value={entry.userId!}>
                            {entry.displayName}
                          </option>
                        ))}
                    </Select>
                  ) : (
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={pending}
                      onClick={() => void addDerivedToRoster(row)}
                    >
                      {t('addToRoster')}
                    </Button>
                  )}
                </div>
              ) : null}
            </div>
          );
        }}
      />

      <p className="mt-3 mb-0 text-xs text-ink-muted">
        {canMutate ? t('hint') : t('readOnlyHint')}
      </p>
      </CollapsibleSection>

      <Modal
        open={wideModalOpen}
        onClose={closeWideModal}
        title={t('title')}
        description={t('wideModalDescription')}
        size="full"
        bodyClassName="!block overflow-auto"
        footer={
          <div className="flex w-full flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            {viewSwitcher(viewMode)}
            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              {canMutate ? (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    resetCreateForm();
                    setCreateOpen(true);
                  }}
                >
                  {t('addItem')}
                </Button>
              ) : null}
              <Button type="button" variant="secondary" onClick={closeWideModal}>
                {t('closeWideView')}
              </Button>
            </div>
          </div>
        }
      >
        {error ? (
          <div className="mb-3">
            <ErrorText>{error}</ErrorText>
          </div>
        ) : null}
        <ProjectStakeholdersOrgChart stakeholders={stakeholders} />
      </Modal>

      <Modal
        open={createOpen}
        onClose={closeCreateModal}
        title={t('addItem')}
        description={t('modalDescription')}
        size="md"
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              onClick={closeCreateModal}
              disabled={pending}
            >
              {tCommon('cancel')}
            </Button>
            <Button
              type="button"
              disabled={pending || !userId}
              onClick={() => void submitCreate()}
            >
              {tCommon('save')}
            </Button>
          </>
        }
      >
        <div className="grid gap-3">
          {error ? <ErrorText>{error}</ErrorText> : null}
          <Field label={t('member')}>
            <Select
              value={userId}
              onChange={(event) => setUserId(event.target.value)}
              disabled={pending}
            >
              <option value="">{t('selectMember')}</option>
              {[
                ...memberOptions,
                ...people
                  .filter((row) => !row.rosterId && row.userId)
                  .map((row) => ({
                    userId: row.userId!,
                    displayName: row.displayName,
                    email: row.email ?? '',
                  })),
              ]
                .filter(
                  (row, index, all) =>
                    all.findIndex((entry) => entry.userId === row.userId) === index,
                )
                .map((row) => (
                  <option key={row.userId} value={row.userId}>
                    {row.displayName} ({row.email})
                  </option>
                ))}
            </Select>
          </Field>
          <Field label={t('projectRoleLabel')}>
            <Select
              value={projectRole}
              onChange={(event) => setProjectRole(event.target.value)}
              disabled={pending}
            >
              {PROJECT_ROLES.map((role) => (
                <option key={role} value={role}>
                  {t(`projectRole.${role}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('jobTitle')}>
            <Input
              value={jobTitle}
              onChange={(event) => setJobTitle(event.target.value)}
              disabled={pending}
            />
          </Field>
          <Field label={t('reportsTo')}>
            <Select
              value={reportsToUserId}
              onChange={(event) => setReportsToUserId(event.target.value)}
              disabled={pending}
            >
              <option value="">{t('noReportsTo')}</option>
              {people
                .filter((row) => row.userId && row.userId !== userId)
                .map((row) => (
                  <option key={row.userId!} value={row.userId!}>
                    {row.displayName}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label={t('notes')}>
            <Input
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              disabled={pending}
            />
          </Field>
        </div>
      </Modal>
    </>
  );
}
