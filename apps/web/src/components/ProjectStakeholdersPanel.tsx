'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
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
import { CollapsibleSection } from './CollapsibleSection';
import { OpsCountStrip } from './ops/OpsCountStrip';
import { ProjectStakeholdersList } from './ProjectStakeholdersList';
import { ProjectStakeholdersOrgChart } from './ProjectStakeholdersOrgChart';
import { ProjectResourceUtilizationView } from './ProjectResourceUtilizationModal';
import { downloadAuthenticatedExport } from '../lib/download-export';
import { parseOptionalNumber } from '../lib/project-currency';

export type StakeholderCompetency = {
  name: string;
  skillId: string | null;
};

export type Stakeholder = {
  kind: 'person' | 'ai_assistant' | 'open_role';
  id: string;
  userId: string | null;
  systemId: string | null;
  displayName: string;
  fullName: string | null;
  email: string | null;
  projectRole: string | null;
  jobTitle: string | null;
  notes: string | null;
  roleDescription: string | null;
  competencies: StakeholderCompetency[];
  staffingStatus: 'open' | 'assigned' | null;
  reportsToUserId: string | null;
  hourlyRate: string | null;
  engagementType: 'employee' | 'contractor' | null;
  assignmentStart: string | null;
  assignmentEnd: string | null;
  allocatedDailyHours: string | null;
  contractRef: string | null;
  contractedBudget: string | null;
  contractStart: string | null;
  contractEnd: string | null;
  aiCostMode: 'flat' | 'api' | 'mixed' | 'note_only' | null;
  aiFlatMonthlyFee: string | null;
  aiTokenRatePer1k: string | null;
  aiBudgetAllocation: string | null;
  avatarUrl: string | null;
  assistantBrand: string | null;
  raciRoles: string[];
  taskCount: number;
  sources: string[];
  rosterId: string | null;
  sortOrder: number;
  systemSlug: string | null;
  systemStatus: string | null;
};

function competenciesToInput(competencies: StakeholderCompetency[] | undefined): string {
  return (competencies ?? []).map((row) => row.name).join(', ');
}

function parseCompetenciesInput(raw: string): string[] {
  return raw
    .split(/[,;\n]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 40);
}

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

const VIEW_MODES = ['list', 'org', 'utilization'] as const;
type ViewMode = (typeof VIEW_MODES)[number];

const ENGAGEMENT_TYPES = ['employee', 'contractor'] as const;
const AI_COST_MODES = ['flat', 'api', 'mixed', 'note_only'] as const;

export function ProjectStakeholdersPanel({
  projectId,
  projectName,
  canMutate,
  initialStakeholders,
  members,
  currency = 'EUR',
}: {
  projectId: string;
  projectName: string;
  canMutate: boolean;
  initialStakeholders: Stakeholder[];
  members: Member[];
  currency?: string;
}) {
  const t = useTranslations('stakeholders');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const searchParams = useSearchParams();
  const { pushToast } = useToast();

  const [stakeholders, setStakeholders] = useState(initialStakeholders);
  useEffect(() => {
    setStakeholders(initialStakeholders);
  }, [initialStakeholders]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [exportPending, setExportPending] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [manageRow, setManageRow] = useState<Stakeholder | null>(null);
  const [manageAiRow, setManageAiRow] = useState<Stakeholder | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('list');

  useEffect(() => {
    if (searchParams.get('utilization') === '1') {
      setViewMode('utilization');
      return;
    }
    if (searchParams.get('stakeholders') === 'org') {
      setViewMode('org');
      return;
    }
    setViewMode('list');
  }, [searchParams]);

  const [createMode, setCreateMode] = useState<'member' | 'open_role'>('member');
  const [userId, setUserId] = useState('');
  const [projectRole, setProjectRole] = useState<string>('stakeholder');
  const [jobTitle, setJobTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [roleDescription, setRoleDescription] = useState('');
  const [competenciesText, setCompetenciesText] = useState('');
  const [reportsToUserId, setReportsToUserId] = useState('');
  const [hourlyRate, setHourlyRate] = useState('');
  const [engagementType, setEngagementType] = useState('');
  const [allocatedDailyHours, setAllocatedDailyHours] = useState('');
  const [assignmentStart, setAssignmentStart] = useState('');
  const [assignmentEnd, setAssignmentEnd] = useState('');
  const [contractRef, setContractRef] = useState('');
  const [contractedBudget, setContractedBudget] = useState('');
  const [contractStart, setContractStart] = useState('');
  const [contractEnd, setContractEnd] = useState('');

  const [editRole, setEditRole] = useState('stakeholder');
  const [editJobTitle, setEditJobTitle] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editRoleDescription, setEditRoleDescription] = useState('');
  const [editCompetenciesText, setEditCompetenciesText] = useState('');
  const [editReportsTo, setEditReportsTo] = useState('');
  const [editHourlyRate, setEditHourlyRate] = useState('');
  const [editEngagementType, setEditEngagementType] = useState('');
  const [editAllocatedDailyHours, setEditAllocatedDailyHours] = useState('');
  const [editAssignmentStart, setEditAssignmentStart] = useState('');
  const [editAssignmentEnd, setEditAssignmentEnd] = useState('');
  const [editContractRef, setEditContractRef] = useState('');
  const [editContractedBudget, setEditContractedBudget] = useState('');
  const [editContractStart, setEditContractStart] = useState('');
  const [editContractEnd, setEditContractEnd] = useState('');
  const [assignUserId, setAssignUserId] = useState('');

  const [editAiCostMode, setEditAiCostMode] = useState('');
  const [editAiFlatMonthlyFee, setEditAiFlatMonthlyFee] = useState('');
  const [editAiTokenRatePer1k, setEditAiTokenRatePer1k] = useState('');
  const [editAiBudgetAllocation, setEditAiBudgetAllocation] = useState('');

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
    try {
      const url = new URL(window.location.href);
      if (mode === 'org') {
        url.searchParams.set('stakeholders', 'org');
        url.searchParams.delete('utilization');
      } else if (mode === 'utilization') {
        url.searchParams.delete('stakeholders');
        url.searchParams.set('utilization', '1');
      } else {
        url.searchParams.delete('stakeholders');
        url.searchParams.delete('utilization');
      }
      url.hash = 'project-stakeholders';
      window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    } catch {
      /* ignore */
    }
  }

  async function exportOrgChartPdf() {
    if (exportPending) return;
    setExportPending(true);
    setError(null);
    try {
      const title = t('orgChartExportTitle', { project: projectName });
      const slug = projectName.replace(/[^\w.-]+/g, '-').toLowerCase();
      await downloadAuthenticatedExport(
        `/api/v1/projects/${projectId}/org-chart/export`,
        `${slug}-org-chart.pdf`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: window.location.origin,
          },
          body: JSON.stringify({ title }),
        },
      );
      pushToast(t('orgChartExported'));
    } catch (err) {
      const message =
        err instanceof Error ? err.message : t('orgChartExportFailed');
      setError(message);
      pushToast(message, 'danger');
    } finally {
      setExportPending(false);
    }
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

  function resetCreateForm() {
    setCreateMode('member');
    setUserId('');
    setProjectRole('stakeholder');
    setJobTitle('');
    setNotes('');
    setRoleDescription('');
    setCompetenciesText('');
    setReportsToUserId('');
    setHourlyRate('');
    setEngagementType('');
    setAllocatedDailyHours('');
    setAssignmentStart('');
    setAssignmentEnd('');
    setContractRef('');
    setContractedBudget('');
    setContractStart('');
    setContractEnd('');
    setError(null);
  }

  function closeCreateModal() {
    setCreateOpen(false);
    resetCreateForm();
  }

  function openManage(row: Stakeholder) {
    setManageRow(row);
    setEditRole(row.projectRole || 'contributor');
    setEditJobTitle(row.jobTitle ?? '');
    setEditNotes(row.notes ?? '');
    setEditRoleDescription(row.roleDescription ?? '');
    setEditCompetenciesText(competenciesToInput(row.competencies));
    setEditReportsTo(row.reportsToUserId ?? '');
    setEditHourlyRate(row.hourlyRate != null ? String(row.hourlyRate) : '');
    setEditEngagementType(row.engagementType ?? '');
    setEditAllocatedDailyHours(
      row.allocatedDailyHours != null ? String(row.allocatedDailyHours) : '',
    );
    setEditAssignmentStart(row.assignmentStart ?? '');
    setEditAssignmentEnd(row.assignmentEnd ?? '');
    setEditContractRef(row.contractRef ?? '');
    setEditContractedBudget(
      row.contractedBudget != null ? String(row.contractedBudget) : '',
    );
    setEditContractStart(row.contractStart ?? '');
    setEditContractEnd(row.contractEnd ?? '');
    setAssignUserId('');
    setConfirmDelete(false);
    setError(null);
  }

  function openManageAi(row: Stakeholder) {
    setManageAiRow(row);
    setEditAiCostMode(row.aiCostMode ?? '');
    setEditAiFlatMonthlyFee(
      row.aiFlatMonthlyFee != null ? String(row.aiFlatMonthlyFee) : '',
    );
    setEditAiTokenRatePer1k(
      row.aiTokenRatePer1k != null ? String(row.aiTokenRatePer1k) : '',
    );
    setEditAiBudgetAllocation(
      row.aiBudgetAllocation != null ? String(row.aiBudgetAllocation) : '',
    );
    setError(null);
  }

  function closeManage() {
    setManageRow(null);
    setConfirmDelete(false);
    setError(null);
  }

  function closeManageAi() {
    setManageAiRow(null);
    setError(null);
  }

  function capacityPayload(input: {
    engagementType: string;
    allocatedDailyHours: string;
    assignmentStart: string;
    assignmentEnd: string;
    contractRef: string;
    contractedBudget: string;
    contractStart: string;
    contractEnd: string;
  }) {
    const parsedEngagement =
      input.engagementType === 'employee' || input.engagementType === 'contractor'
        ? input.engagementType
        : null;
    return {
      engagementType: parsedEngagement,
      allocatedDailyHours: parseOptionalNumber(input.allocatedDailyHours) ?? null,
      assignmentStart: input.assignmentStart || null,
      assignmentEnd: input.assignmentEnd || null,
      contractRef: input.contractRef.trim() || null,
      contractedBudget: parseOptionalNumber(input.contractedBudget) ?? null,
      contractStart: input.contractStart || null,
      contractEnd: input.contractEnd || null,
    };
  }

  async function submitCreate() {
    const isOpenRole = createMode === 'open_role';
    if (pending) return;
    if (isOpenRole && !jobTitle.trim()) {
      setError(t('openRoleTitleRequired'));
      return;
    }
    if (!isOpenRole && !userId) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/projects/${projectId}/stakeholders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(isOpenRole ? {} : { userId }),
          projectRole,
          jobTitle: jobTitle.trim() || null,
          notes: notes.trim() || null,
          roleDescription: roleDescription.trim() || null,
          competencies: parseCompetenciesInput(competenciesText),
          reportsToUserId: reportsToUserId || null,
          hourlyRate: parseOptionalNumber(hourlyRate) ?? null,
          ...capacityPayload({
            engagementType,
            allocatedDailyHours,
            assignmentStart,
            assignmentEnd,
            contractRef,
            contractedBudget,
            contractStart,
            contractEnd,
          }),
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          message?: string;
          error?: string | { message?: string };
        } | null;
        const errMsg =
          typeof payload?.error === 'object'
            ? payload.error.message
            : typeof payload?.error === 'string'
              ? payload.error
              : payload?.message;
        throw new Error(errMsg || t('failedCreate'));
      }
      pushToast(isOpenRole ? t('openRoleCreated') : t('created'));
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
          hourlyRate: row.hourlyRate,
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

  async function saveManage() {
    if (!manageRow?.rosterId || pending) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/v1/project-stakeholders/${manageRow.rosterId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectRole: editRole,
            jobTitle: editJobTitle.trim() || null,
            notes: editNotes.trim() || null,
            roleDescription: editRoleDescription.trim() || null,
            competencies: parseCompetenciesInput(editCompetenciesText),
            reportsToUserId: editReportsTo || null,
            hourlyRate: parseOptionalNumber(editHourlyRate) ?? null,
            ...capacityPayload({
              engagementType: editEngagementType,
              allocatedDailyHours: editAllocatedDailyHours,
              assignmentStart: editAssignmentStart,
              assignmentEnd: editAssignmentEnd,
              contractRef: editContractRef,
              contractedBudget: editContractedBudget,
              contractStart: editContractStart,
              contractEnd: editContractEnd,
            }),
          }),
        },
      );
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          message?: string;
          error?: { message?: string };
        } | null;
        throw new Error(
          payload?.error?.message || payload?.message || t('failedUpdate'),
        );
      }
      pushToast(t('updated'));
      closeManage();
      await reloadStakeholders();
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('failedUpdate'));
    } finally {
      setPending(false);
    }
  }

  async function assignManage() {
    if (!manageRow?.rosterId || !assignUserId || pending) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/v1/project-stakeholders/${manageRow.rosterId}/assign`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: assignUserId }),
        },
      );
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          message?: string;
          error?: { message?: string };
        } | null;
        throw new Error(
          payload?.error?.message || payload?.message || t('failedAssign'),
        );
      }
      pushToast(t('assigned'));
      closeManage();
      await reloadStakeholders();
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('failedAssign'));
    } finally {
      setPending(false);
    }
  }

  async function unassignManage() {
    if (!manageRow?.rosterId || pending) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/v1/project-stakeholders/${manageRow.rosterId}/unassign`,
        { method: 'POST' },
      );
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          message?: string;
          error?: { message?: string };
        } | null;
        throw new Error(
          payload?.error?.message || payload?.message || t('failedUnassign'),
        );
      }
      pushToast(t('unassigned'));
      closeManage();
      await reloadStakeholders();
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('failedUnassign'));
    } finally {
      setPending(false);
    }
  }

  async function saveManageAi() {
    if (!manageAiRow?.systemId || pending) return;
    setPending(true);
    setError(null);
    try {
      const parsedMode =
        editAiCostMode === 'flat' ||
        editAiCostMode === 'api' ||
        editAiCostMode === 'mixed' ||
        editAiCostMode === 'note_only'
          ? editAiCostMode
          : null;
      const response = await fetch(
        `/api/v1/systems/${manageAiRow.systemId}/ai-cost`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            aiCostMode: parsedMode,
            aiFlatMonthlyFee: parseOptionalNumber(editAiFlatMonthlyFee) ?? null,
            aiTokenRatePer1k: parseOptionalNumber(editAiTokenRatePer1k) ?? null,
            aiBudgetAllocation:
              parseOptionalNumber(editAiBudgetAllocation) ?? null,
          }),
        },
      );
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          message?: string;
          error?: { message?: string };
        } | null;
        throw new Error(
          payload?.error?.message || payload?.message || t('failedUpdateAiCost'),
        );
      }
      pushToast(t('aiCostUpdated'));
      closeManageAi();
      await reloadStakeholders();
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('failedUpdateAiCost'));
    } finally {
      setPending(false);
    }
  }

  async function deleteManage() {
    if (!manageRow?.rosterId || pending) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/v1/project-stakeholders/${manageRow.rosterId}`,
        { method: 'DELETE' },
      );
      if (!response.ok) {
        throw new Error(t('failedDelete'));
      }
      pushToast(t('deleted'));
      closeManage();
      await reloadStakeholders();
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('failedDelete'));
    } finally {
      setPending(false);
      setConfirmDelete(false);
    }
  }

  function renderCapacityFields(input: {
    engagement: string;
    setEngagement: (value: string) => void;
    dailyHours: string;
    setDailyHours: (value: string) => void;
    assignStart: string;
    setAssignStart: (value: string) => void;
    assignEnd: string;
    setAssignEnd: (value: string) => void;
    contractRefValue: string;
    setContractRefValue: (value: string) => void;
    contractedBudgetValue: string;
    setContractedBudgetValue: (value: string) => void;
    contractStartValue: string;
    setContractStartValue: (value: string) => void;
    contractEndValue: string;
    setContractEndValue: (value: string) => void;
    disabled: boolean;
  }) {
    const isEmployee = input.engagement === 'employee';
    const isContractor = input.engagement === 'contractor';
    return (
      <>
        <Field label={t('engagementType')}>
          <Select
            value={input.engagement}
            onChange={(event) => input.setEngagement(event.target.value)}
            disabled={input.disabled}
          >
            <option value="">{t('engagementUnset')}</option>
            {ENGAGEMENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(`engagement.${type}`)}
              </option>
            ))}
          </Select>
        </Field>
        {(isEmployee || isContractor) && (
          <Field label={t('allocatedDailyHours')}>
            <Input
              type="number"
              min="0"
              step="0.25"
              value={input.dailyHours}
              onChange={(event) => input.setDailyHours(event.target.value)}
              disabled={input.disabled}
              placeholder={t('allocatedDailyHoursPlaceholder')}
            />
          </Field>
        )}
        {isEmployee ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('assignmentStart')}>
              <Input
                type="date"
                value={input.assignStart}
                onChange={(event) => input.setAssignStart(event.target.value)}
                disabled={input.disabled}
              />
            </Field>
            <Field label={t('assignmentEnd')}>
              <Input
                type="date"
                value={input.assignEnd}
                onChange={(event) => input.setAssignEnd(event.target.value)}
                disabled={input.disabled}
              />
            </Field>
          </div>
        ) : null}
        {isContractor ? (
          <>
            <Field label={t('contractRef')}>
              <Input
                value={input.contractRefValue}
                onChange={(event) =>
                  input.setContractRefValue(event.target.value)
                }
                disabled={input.disabled}
              />
            </Field>
            <Field label={t('contractedBudget')}>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={input.contractedBudgetValue}
                onChange={(event) =>
                  input.setContractedBudgetValue(event.target.value)
                }
                disabled={input.disabled}
                placeholder={t('contractedBudgetPlaceholder', { currency })}
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('contractStart')}>
                <Input
                  type="date"
                  value={input.contractStartValue}
                  onChange={(event) =>
                    input.setContractStartValue(event.target.value)
                  }
                  disabled={input.disabled}
                />
              </Field>
              <Field label={t('contractEnd')}>
                <Input
                  type="date"
                  value={input.contractEndValue}
                  onChange={(event) =>
                    input.setContractEndValue(event.target.value)
                  }
                  disabled={input.disabled}
                />
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('assignmentStart')}>
                <Input
                  type="date"
                  value={input.assignStart}
                  onChange={(event) => input.setAssignStart(event.target.value)}
                  disabled={input.disabled}
                />
              </Field>
              <Field label={t('assignmentEnd')}>
                <Input
                  type="date"
                  value={input.assignEnd}
                  onChange={(event) => input.setAssignEnd(event.target.value)}
                  disabled={input.disabled}
                />
              </Field>
            </div>
          </>
        ) : null}
      </>
    );
  }

  const memberOptions = members.filter(
    (member) =>
      !people.some((row) => row.userId === member.userId && row.rosterId),
  );

  return (
    <>
      <CollapsibleSection
        id="project-stakeholders"
        storageKey={`project:${projectId}:stakeholders`}
        title={t('title')}
        defaultOpen
      >
      {error && !createOpen && !manageRow && !manageAiRow ? (
        <div className="mb-3">
          <ErrorText>{error}</ErrorText>
        </div>
      ) : null}

      <OpsCountStrip
        items={[
          {
            label: t('countPeople'),
            value: stakeholders.filter((row) => row.kind === 'person').length,
          },
          {
            label: t('countAi'),
            value: stakeholders.filter((row) => row.kind === 'ai_assistant').length,
          },
          {
            label: t('countOpenRoles'),
            value: stakeholders.filter((row) => row.kind === 'open_role').length,
          },
          {
            label: t('countAssigned'),
            value: stakeholders.filter((row) => row.staffingStatus === 'assigned').length,
          },
          {
            label: t('countTotal'),
            value: stakeholders.length,
          },
        ]}
      />

      <div
        className="kh-ops-delivery-modes"
        role="group"
        aria-label={t('viewModeLabel')}
      >
        {VIEW_MODES.map((mode) => (
          <button
            key={mode}
            type="button"
            aria-pressed={viewMode === mode}
            onClick={() => changeViewMode(mode)}
          >
            {t(`viewMode.${mode}`)}
          </button>
        ))}
      </div>

      {viewMode === 'org' ? (
        <div className="kh-ops-toolbar">
          <Button
            type="button"
            variant="secondary"
            disabled={exportPending || stakeholders.length === 0}
            onClick={() => void exportOrgChartPdf()}
          >
            {exportPending ? t('orgChartExportingPdf') : t('orgChartExportPdf')}
          </Button>
          {canMutate ? (
            <Button
              type="button"
              onClick={() => {
                resetCreateForm();
                setCreateOpen(true);
              }}
            >
              {t('addItem')}
            </Button>
          ) : null}
        </div>
      ) : null}

      {viewMode === 'list' ? (
        <ProjectStakeholdersList
          stakeholders={stakeholders}
          canMutate={canMutate}
          pending={pending}
          nameById={nameById}
          currency={currency}
          onManage={openManage}
          onManageAi={openManageAi}
          onAddDerived={(row) => void addDerivedToRoster(row)}
          onCreate={() => {
            resetCreateForm();
            setCreateOpen(true);
          }}
        />
      ) : null}

      {viewMode === 'org' ? (
        <section className="kh-ops-panel">
          <div className="kh-ops-panel-head">
            <h2 className="kh-ops-panel-title">{t('viewMode.org')}</h2>
            <span className="kh-ops-panel-meta">{t('orgChartHint')}</span>
          </div>
          <div className="p-3">
            <ProjectStakeholdersOrgChart stakeholders={stakeholders} />
          </div>
        </section>
      ) : null}

      <ProjectResourceUtilizationView
        projectId={projectId}
        active={viewMode === 'utilization'}
      />

      <p className="mt-3 mb-0 text-xs text-ink-muted">
        {canMutate ? t('hint') : t('readOnlyHint')}
      </p>
      </CollapsibleSection>

      <Modal
        open={createOpen}
        onClose={closeCreateModal}
        title={t('addItem')}
        description={
          createMode === 'open_role'
            ? t('openRoleModalDescription')
            : t('modalDescription')
        }
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
              disabled={
                pending ||
                (createMode === 'open_role'
                  ? !jobTitle.trim()
                  : !userId)
              }
              onClick={() => void submitCreate()}
            >
              {tCommon('save')}
            </Button>
          </>
        }
      >
        <div className="grid gap-3">
          {error ? <ErrorText>{error}</ErrorText> : null}
          <Field label={t('createModeLabel')}>
            <Select
              value={createMode}
              onChange={(event) => {
                const next = event.target.value === 'open_role' ? 'open_role' : 'member';
                setCreateMode(next);
                if (next === 'open_role') setUserId('');
              }}
              disabled={pending}
            >
              <option value="member">{t('createModeMember')}</option>
              <option value="open_role">{t('createModeOpenRole')}</option>
            </Select>
          </Field>
          {createMode === 'member' ? (
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
                      all.findIndex((entry) => entry.userId === row.userId) ===
                      index,
                  )
                  .map((row) => (
                    <option key={row.userId} value={row.userId}>
                      {row.displayName} ({row.email})
                    </option>
                  ))}
              </Select>
            </Field>
          ) : null}
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
          <Field
            label={
              createMode === 'open_role' ? t('openRoleTitle') : t('jobTitle')
            }
          >
            <Input
              value={jobTitle}
              onChange={(event) => setJobTitle(event.target.value)}
              disabled={pending}
              placeholder={
                createMode === 'open_role'
                  ? t('openRoleTitlePlaceholder')
                  : undefined
              }
            />
          </Field>
          <Field label={t('roleDescription')}>
            <Textarea
              value={roleDescription}
              onChange={(event) => setRoleDescription(event.target.value)}
              disabled={pending}
              rows={3}
              placeholder={t('roleDescriptionPlaceholder')}
            />
          </Field>
          <Field label={t('competencies')}>
            <Input
              value={competenciesText}
              onChange={(event) => setCompetenciesText(event.target.value)}
              disabled={pending}
              placeholder={t('competenciesPlaceholder')}
            />
          </Field>
          <Field label={t('hourlyRate')}>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={hourlyRate}
              onChange={(event) => setHourlyRate(event.target.value)}
              disabled={pending}
              placeholder={t('hourlyRatePlaceholder', { currency })}
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
          {renderCapacityFields({
            engagement: engagementType,
            setEngagement: setEngagementType,
            dailyHours: allocatedDailyHours,
            setDailyHours: setAllocatedDailyHours,
            assignStart: assignmentStart,
            setAssignStart: setAssignmentStart,
            assignEnd: assignmentEnd,
            setAssignEnd: setAssignmentEnd,
            contractRefValue: contractRef,
            setContractRefValue: setContractRef,
            contractedBudgetValue: contractedBudget,
            setContractedBudgetValue: setContractedBudget,
            contractStartValue: contractStart,
            setContractStartValue: setContractStart,
            contractEndValue: contractEnd,
            setContractEndValue: setContractEnd,
            disabled: pending,
          })}
        </div>
      </Modal>

      <Modal
        open={Boolean(manageRow)}
        onClose={closeManage}
        title={
          manageRow?.kind === 'open_role'
            ? t('manageOpenRoleTitle')
            : t('manageTitle')
        }
        description={
          manageRow?.kind === 'open_role'
            ? t('manageOpenRoleDescription')
            : t('manageDescription')
        }
        size="md"
        footer={
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <div>
              {canMutate && manageRow?.rosterId ? (
                !confirmDelete ? (
                  <Button
                    type="button"
                    variant="danger"
                    disabled={pending}
                    onClick={() => setConfirmDelete(true)}
                  >
                    {t('deleteItem')}
                  </Button>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={pending}
                      onClick={() => setConfirmDelete(false)}
                    >
                      {tCommon('cancel')}
                    </Button>
                    <Button
                      type="button"
                      variant="danger"
                      disabled={pending}
                      onClick={() => void deleteManage()}
                    >
                      {t('confirmDelete')}
                    </Button>
                  </div>
                )
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {canMutate &&
              manageRow?.kind === 'person' &&
              manageRow.userId &&
              manageRow.rosterId &&
              !confirmDelete ? (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={pending}
                  onClick={() => void unassignManage()}
                >
                  {t('unassign')}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="secondary"
                onClick={closeManage}
                disabled={pending}
              >
                {tCommon('cancel')}
              </Button>
              <Button
                type="button"
                disabled={pending || confirmDelete}
                onClick={() => void saveManage()}
              >
                {tCommon('save')}
              </Button>
            </div>
          </div>
        }
      >
        <div className="grid gap-3">
          {error ? <ErrorText>{error}</ErrorText> : null}
          {confirmDelete ? (
            <p className="m-0 text-sm font-semibold text-danger">
              {t('deleteHint')}
            </p>
          ) : null}
          <p className="m-0 text-sm font-semibold">
            {manageRow?.displayName}
            {manageRow?.email ? (
              <span className="font-normal text-ink-muted">
                {' '}
                ({manageRow.email})
              </span>
            ) : null}
          </p>
          {manageRow?.kind === 'open_role' && !confirmDelete ? (
            <div className="grid gap-2 rounded-md border border-line p-3">
              <Field label={t('assignColleague')}>
                <Select
                  value={assignUserId}
                  onChange={(event) => setAssignUserId(event.target.value)}
                  disabled={pending}
                >
                  <option value="">{t('selectMember')}</option>
                  {memberOptions.map((row) => (
                    <option key={row.userId} value={row.userId}>
                      {row.displayName} ({row.email})
                    </option>
                  ))}
                </Select>
              </Field>
              <Button
                type="button"
                disabled={pending || !assignUserId}
                onClick={() => void assignManage()}
              >
                {t('assign')}
              </Button>
            </div>
          ) : null}
          <Field label={t('projectRoleLabel')}>
            <Select
              value={editRole}
              onChange={(event) => setEditRole(event.target.value)}
              disabled={pending || confirmDelete}
            >
              {PROJECT_ROLES.map((role) => (
                <option key={role} value={role}>
                  {t(`projectRole.${role}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label={
              manageRow?.kind === 'open_role' ? t('openRoleTitle') : t('jobTitle')
            }
          >
            <Input
              value={editJobTitle}
              onChange={(event) => setEditJobTitle(event.target.value)}
              disabled={pending || confirmDelete}
            />
          </Field>
          <Field label={t('roleDescription')}>
            <Textarea
              value={editRoleDescription}
              onChange={(event) => setEditRoleDescription(event.target.value)}
              disabled={pending || confirmDelete}
              rows={3}
              placeholder={t('roleDescriptionPlaceholder')}
            />
          </Field>
          <Field label={t('competencies')}>
            <Input
              value={editCompetenciesText}
              onChange={(event) => setEditCompetenciesText(event.target.value)}
              disabled={pending || confirmDelete}
              placeholder={t('competenciesPlaceholder')}
            />
          </Field>
          <Field label={t('hourlyRate')}>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={editHourlyRate}
              onChange={(event) => setEditHourlyRate(event.target.value)}
              disabled={pending || confirmDelete}
              placeholder={t('hourlyRatePlaceholder', { currency })}
            />
          </Field>
          <Field label={t('reportsTo')}>
            <Select
              value={editReportsTo}
              onChange={(event) => setEditReportsTo(event.target.value)}
              disabled={pending || confirmDelete}
            >
              <option value="">{t('noReportsTo')}</option>
              {people
                .filter(
                  (row) => row.userId && row.userId !== manageRow?.userId,
                )
                .map((row) => (
                  <option key={row.userId!} value={row.userId!}>
                    {row.displayName}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label={t('notes')}>
            <Textarea
              value={editNotes}
              onChange={(event) => setEditNotes(event.target.value)}
              disabled={pending || confirmDelete}
              rows={3}
            />
          </Field>
          {renderCapacityFields({
            engagement: editEngagementType,
            setEngagement: setEditEngagementType,
            dailyHours: editAllocatedDailyHours,
            setDailyHours: setEditAllocatedDailyHours,
            assignStart: editAssignmentStart,
            setAssignStart: setEditAssignmentStart,
            assignEnd: editAssignmentEnd,
            setAssignEnd: setEditAssignmentEnd,
            contractRefValue: editContractRef,
            setContractRefValue: setEditContractRef,
            contractedBudgetValue: editContractedBudget,
            setContractedBudgetValue: setEditContractedBudget,
            contractStartValue: editContractStart,
            setContractStartValue: setEditContractStart,
            contractEndValue: editContractEnd,
            setContractEndValue: setEditContractEnd,
            disabled: pending || confirmDelete,
          })}
        </div>
      </Modal>

      <Modal
        open={Boolean(manageAiRow)}
        onClose={closeManageAi}
        title={t('manageAiCostTitle')}
        description={t('manageAiCostDescription')}
        size="md"
        footer={
          <div className="flex w-full flex-wrap items-center justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={closeManageAi}
              disabled={pending}
            >
              {tCommon('cancel')}
            </Button>
            <Button
              type="button"
              disabled={pending}
              onClick={() => void saveManageAi()}
            >
              {tCommon('save')}
            </Button>
          </div>
        }
      >
        <div className="grid gap-3">
          {error ? <ErrorText>{error}</ErrorText> : null}
          <p className="m-0 text-sm font-semibold">{manageAiRow?.displayName}</p>
          <Field label={t('aiCostModeLabel')}>
            <Select
              value={editAiCostMode}
              onChange={(event) => setEditAiCostMode(event.target.value)}
              disabled={pending}
            >
              <option value="">{t('aiCostModeUnset')}</option>
              {AI_COST_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {t(`aiCostMode.${mode}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('aiFlatMonthlyFee')}>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={editAiFlatMonthlyFee}
              onChange={(event) => setEditAiFlatMonthlyFee(event.target.value)}
              disabled={pending}
              placeholder={t('aiFlatMonthlyFeePlaceholder', { currency })}
            />
          </Field>
          <Field label={t('aiTokenRatePer1k')}>
            <Input
              type="number"
              min="0"
              step="0.0001"
              value={editAiTokenRatePer1k}
              onChange={(event) => setEditAiTokenRatePer1k(event.target.value)}
              disabled={pending}
              placeholder={t('aiTokenRatePer1kPlaceholder', { currency })}
            />
          </Field>
          <Field label={t('aiBudgetAllocation')}>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={editAiBudgetAllocation}
              onChange={(event) =>
                setEditAiBudgetAllocation(event.target.value)
              }
              disabled={pending}
              placeholder={t('aiBudgetAllocationPlaceholder', { currency })}
            />
          </Field>
        </div>
      </Modal>
    </>
  );
}
