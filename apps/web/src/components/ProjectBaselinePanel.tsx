'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import {
  coerceProjectCalendar,
  planDurationWorkingDays,
  suggestKeyPrefix,
} from '@project-knowledge-hub/domain';
import { CollapsibleSection } from './CollapsibleSection';
import {
  DeliveryDocumentsEditor,
  type DeliveryDocumentRecord,
} from './DeliveryDocumentsEditor';
import { LocalDateTime } from './LocalDateTime';
import { recordHref } from '../lib/record-href';
import {
  PROJECT_CURRENCIES,
  formatMoney,
  parseOptionalNumber,
} from '../lib/project-currency';
import {
  Badge,
  Button,
  DELIVERY_ITEM_MODAL_SIZE,
  ErrorText,
  Field,
  Input,
  Modal,
  Select,
  Switch,
  Textarea,
  useToast,
} from './ui';

export type PinnedRecord = {
  id: string;
  title: string;
  slug: string;
  recordType: string;
  humanKey?: string | null;
};

export type BaselineScheduleChange = {
  id: string;
  humanKey: string | null;
  title: string;
  baselineEndAfter: string | null;
};

export type InitialStakeholder = {
  id: string;
  userId: string;
  displayName: string;
  email: string;
  projectRole: string;
  sortOrder: number;
};

export type BaselineProject = {
  id: string;
  name?: string;
  slug?: string;
  startDate: string | null;
  endDate: string | null;
  hoursPerWorkday?: number | null;
  workdaysPerWeek?: number | null;
  nonWorkingDays?: string[];
  finishDate?: string | null;
  forecastFinishDate?: string | null;
  baselineFinishDate?: string | null;
  durationWorkingDays?: number | null;
  charterRecordId: string | null;
  charterRecord: PinnedRecord | null;
  initialPlanRecordId: string | null;
  initialPlanRecord: PinnedRecord | null;
  definitionOfDone?: string | null;
  currency?: string;
  initialBudget?: string | number | null;
  approvedBudget?: string | number | null;
  keyPrefix?: string | null;
  scheduleSlipRiskEnabled?: boolean;
  scheduleSlipThresholdDays?: number;
  scheduleSlipItemTypes?: string[];
};

type Member = {
  userId: string;
  displayName: string;
  email: string;
};

type KnowledgeOption = {
  id: string;
  title: string;
  slug: string;
  recordType: string;
  humanKey?: string | null;
};

const PROJECT_ROLES = [
  'sponsor',
  'owner',
  'project_manager',
  'scrum_master',
  'product_owner',
  'tech_lead',
  'contributor',
  'stakeholder',
  'other',
] as const;

type DraftStakeholder = {
  userId: string;
  projectRole: string;
};

const SLIP_TYPES = ['task', 'user_story', 'epic', 'milestone'] as const;

type PrefixMention = {
  id: string;
  title: string;
  slug: string;
  projectSlug: string | null;
  excerpt: string;
};

type RetiredPrefix = {
  keyPrefix: string;
  releasedAt: string | null;
};

export function ProjectBaselinePanel({
  projectId,
  workspaceSlug,
  canMutate,
  canReleasePrefixes = false,
  project,
  initialStakeholders,
  members,
  knowledgeRecords,
  scheduleChanges = [],
}: {
  projectId: string;
  workspaceSlug: string;
  canMutate: boolean;
  canReleasePrefixes?: boolean;
  project: BaselineProject;
  initialStakeholders: InitialStakeholder[];
  members: Member[];
  knowledgeRecords: KnowledgeOption[];
  scheduleChanges?: BaselineScheduleChange[];
}) {
  const t = useTranslations('baseline');
  const tStakeholders = useTranslations('stakeholders');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const { pushToast } = useToast();

  const [stakeholders, setStakeholders] = useState(initialStakeholders);
  useEffect(() => {
    setStakeholders(initialStakeholders);
  }, [initialStakeholders]);

  const [editOpen, setEditOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [startDate, setStartDate] = useState(project.startDate ?? '');
  const [hoursPerWorkday, setHoursPerWorkday] = useState(
    String(project.hoursPerWorkday ?? 8),
  );
  const [workdaysPerWeek, setWorkdaysPerWeek] = useState(
    String(project.workdaysPerWeek ?? 5),
  );
  const [nonWorkingDays, setNonWorkingDays] = useState<string[]>(
    project.nonWorkingDays ?? [],
  );
  const [holidayDraft, setHolidayDraft] = useState('');
  const [charterRecordId, setCharterRecordId] = useState(
    project.charterRecordId ?? '',
  );
  const [initialPlanRecordId, setInitialPlanRecordId] = useState(
    project.initialPlanRecordId ?? '',
  );
  const [currency, setCurrency] = useState(project.currency ?? 'EUR');
  const [initialBudget, setInitialBudget] = useState(
    project.initialBudget != null ? String(project.initialBudget) : '',
  );
  const [keyPrefix, setKeyPrefix] = useState(
    (project.keyPrefix ?? '').toUpperCase(),
  );
  const [definitionOfDone, setDefinitionOfDone] = useState(
    project.definitionOfDone ?? '',
  );
  const [slipEnabled, setSlipEnabled] = useState(
    project.scheduleSlipRiskEnabled === true,
  );
  const [slipThreshold, setSlipThreshold] = useState(
    String(project.scheduleSlipThresholdDays ?? 2),
  );
  const [slipTypes, setSlipTypes] = useState<string[]>(
    project.scheduleSlipItemTypes ?? [...SLIP_TYPES],
  );
  const [draftStakeholders, setDraftStakeholders] = useState<DraftStakeholder[]>(
    [],
  );
  const [prefixConfirm, setPrefixConfirm] = useState<{
    previous: string;
    next: string;
    mentions: PrefixMention[];
    mentionsFailed: boolean;
  } | null>(null);
  const [retiredPrefixes, setRetiredPrefixes] = useState<RetiredPrefix[]>([]);

  const currencyCode = project.currency ?? 'EUR';
  const initialBudgetNumber =
    project.initialBudget == null || project.initialBudget === ''
      ? null
      : Number(project.initialBudget);

  function preferType(
    records: KnowledgeOption[],
    preferred: string,
  ): DeliveryDocumentRecord[] {
    return [...records]
      .sort((left, right) => {
        const leftRank = left.recordType === preferred ? 0 : 1;
        const rightRank = right.recordType === preferred ? 0 : 1;
        if (leftRank !== rightRank) return leftRank - rightRank;
        return left.title.localeCompare(right.title);
      })
      .map((row) => ({
        id: row.id,
        title: row.title,
        slug: row.slug,
        humanKey: row.humanKey ?? null,
        recordType: row.recordType,
      }));
  }

  function singleRecordId(current: string, next: string[]): string {
    if (next.length === 0) return '';
    const added = next.filter((id) => id !== current);
    if (added.length > 0) return added[added.length - 1] ?? '';
    return next[next.length - 1] ?? '';
  }

  function pinnedDocument(
    record: PinnedRecord | null,
  ): DeliveryDocumentRecord[] {
    if (!record) return [];
    return [{
      id: record.id,
      title: record.title,
      slug: record.slug,
      humanKey: record.humanKey ?? null,
      recordType: record.recordType,
    }];
  }

  function openEdit() {
    setStartDate(project.startDate ?? '');
    setHoursPerWorkday(String(project.hoursPerWorkday ?? 8));
    setWorkdaysPerWeek(String(project.workdaysPerWeek ?? 5));
    setNonWorkingDays([...(project.nonWorkingDays ?? [])].sort());
    setHolidayDraft('');
    setCharterRecordId(project.charterRecordId ?? '');
    setInitialPlanRecordId(project.initialPlanRecordId ?? '');
    setCurrency(project.currency ?? 'EUR');
    setInitialBudget(
      project.initialBudget != null ? String(project.initialBudget) : '',
    );
    setKeyPrefix(
      (project.keyPrefix ||
        suggestKeyPrefix(project.slug || project.name || 'PRJ')).toUpperCase(),
    );
    setDefinitionOfDone(project.definitionOfDone ?? '');
    setSlipEnabled(project.scheduleSlipRiskEnabled === true);
    setSlipThreshold(String(project.scheduleSlipThresholdDays ?? 2));
    setSlipTypes(project.scheduleSlipItemTypes ?? [...SLIP_TYPES]);
    setDraftStakeholders(
      stakeholders.map((row) => ({
        userId: row.userId,
        projectRole: row.projectRole || 'stakeholder',
      })),
    );
    setError(null);
    setPrefixConfirm(null);
    setEditOpen(true);
    if (canReleasePrefixes) {
      void loadRetiredPrefixes();
    }
  }

  async function loadRetiredPrefixes() {
    const response = await fetch(
      `/api/v1/projects/${projectId}/key-prefix-history`,
      { credentials: 'include' },
    );
    if (!response.ok) return;
    const payload = (await response.json()) as { prefixes?: RetiredPrefix[] };
    setRetiredPrefixes(
      (payload.prefixes ?? []).filter((row) => !row.releasedAt),
    );
  }

  function addNonWorkingDay() {
    const day = holidayDraft.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
    setNonWorkingDays((prev) =>
      prev.includes(day) ? prev : [...prev, day].sort(),
    );
    setHolidayDraft('');
  }

  function removeNonWorkingDay(day: string) {
    setNonWorkingDays((prev) => prev.filter((value) => value !== day));
  }

  function toggleMember(userId: string) {
    setDraftStakeholders((prev) => {
      const exists = prev.find((row) => row.userId === userId);
      if (exists) {
        return prev.filter((row) => row.userId !== userId);
      }
      return [...prev, { userId, projectRole: 'stakeholder' }];
    });
  }

  function setMemberRole(userId: string, projectRole: string) {
    setDraftStakeholders((prev) =>
      prev.map((row) =>
        row.userId === userId ? { ...row, projectRole } : row,
      ),
    );
  }

  async function save() {
    if (!canMutate) return;
    const thresholdDays = Number(slipThreshold);
    if (!Number.isInteger(thresholdDays) || thresholdDays < 1 || thresholdDays > 3650) {
      setError(t('scheduleSlipThreshold'));
      return;
    }
    const nextPrefix = keyPrefix.trim().toUpperCase();
    const previousPrefix = (project.keyPrefix ?? '').toUpperCase();
    if (previousPrefix && nextPrefix && nextPrefix !== previousPrefix) {
      setPending(true);
      setError(null);
      let mentions: PrefixMention[] = [];
      let mentionsFailed = false;
      try {
        const response = await fetch(
          `/api/v1/projects/${projectId}/key-prefix-mentions?prefix=${encodeURIComponent(previousPrefix)}`,
          { credentials: 'include' },
        );
        if (!response.ok) {
          mentionsFailed = true;
        } else {
          const payload = (await response.json()) as { mentions?: PrefixMention[] };
          mentions = payload.mentions ?? [];
        }
      } catch {
        mentionsFailed = true;
      } finally {
        setPending(false);
      }
      setPrefixConfirm({
        previous: previousPrefix,
        next: nextPrefix,
        mentions,
        mentionsFailed,
      });
      return;
    }
    await persistBaseline(thresholdDays);
  }

  async function releasePrefix(prefix: string) {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/v1/projects/${projectId}/key-prefix-history/${encodeURIComponent(prefix)}/release`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { Origin: window.location.origin },
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(payload.error?.message || t('failedUpdate'));
      }
      setRetiredPrefixes((rows) => rows.filter((row) => row.keyPrefix !== prefix));
      pushToast(t('keyPrefixReleased'), 'success');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('failedUpdate'));
    } finally {
      setPending(false);
    }
  }

  async function persistBaseline(thresholdDays: number) {
    setPending(true);
    setError(null);
    try {
      const patchResponse = await fetch(`/api/v1/projects/${projectId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Origin: window.location.origin,
        },
        body: JSON.stringify({
          startDate: startDate || null,
          hoursPerWorkday: Number(hoursPerWorkday),
          workdaysPerWeek: Number(workdaysPerWeek),
          nonWorkingDays,
          charterRecordId: charterRecordId || null,
          initialPlanRecordId: initialPlanRecordId || null,
          currency,
          initialBudget: parseOptionalNumber(initialBudget) ?? null,
          keyPrefix: keyPrefix.trim().toUpperCase(),
          definitionOfDone: definitionOfDone.trim() || null,
          scheduleSlipRiskEnabled: slipEnabled,
          scheduleSlipThresholdDays: thresholdDays,
          scheduleSlipItemTypes: slipTypes,
        }),
      });
      const patchPayload = (await patchResponse.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      if (!patchResponse.ok) {
        throw new Error(patchPayload.error?.message || t('failedUpdate'));
      }

      const stakeholdersResponse = await fetch(
        `/api/v1/projects/${projectId}/initial-stakeholders`,
        {
          method: 'PUT',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            Origin: window.location.origin,
          },
          body: JSON.stringify({
            stakeholders: draftStakeholders.map((row, index) => ({
              userId: row.userId,
              projectRole: row.projectRole,
              sortOrder: index,
            })),
          }),
        },
      );
      const stakeholdersPayload = (await stakeholdersResponse
        .json()
        .catch(() => ({}))) as {
        initialStakeholders?: InitialStakeholder[];
        error?: { message?: string };
      };
      if (!stakeholdersResponse.ok) {
        throw new Error(
          stakeholdersPayload.error?.message || t('failedUpdate'),
        );
      }
      if (stakeholdersPayload.initialStakeholders) {
        setStakeholders(stakeholdersPayload.initialStakeholders);
      }
      setPrefixConfirm(null);
      setEditOpen(false);
      pushToast(t('updated'), 'success');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('failedUpdate'));
    } finally {
      setPending(false);
    }
  }

  function dateLabel(value: string | null | undefined) {
    if (!value) return tCommon('none');
    return <LocalDateTime value={value} dateOnly className="tabular-nums" />;
  }

  const approvedFinish = project.baselineFinishDate ?? project.endDate ?? null;
  const forecastFinish = project.forecastFinishDate ?? project.finishDate ?? null;
  const baselineFinish = approvedFinish ?? forecastFinish;
  const baselineFinishIsForecast = !approvedFinish && Boolean(forecastFinish);
  const forecastDuration = planDurationWorkingDays(
    { start: project.startDate ?? null, finish: forecastFinish },
    coerceProjectCalendar({
      hoursPerWorkday: project.hoursPerWorkday,
      workdaysPerWeek: project.workdaysPerWeek,
      nonWorkingDays: project.nonWorkingDays ?? [],
    }),
  );
  const durationCount = project.durationWorkingDays ?? (approvedFinish ? null : forecastDuration);
  const durationIsForecast = project.durationWorkingDays == null && forecastDuration != null && !approvedFinish;

  const durationLabel =
    durationCount == null
      ? tCommon('none')
      : durationIsForecast
        ? t('forecastDurationValue', { count: durationCount })
        : t('durationValue', { count: durationCount });
  const draftFinish = approvedFinish ?? forecastFinish;
  const draftDuration = planDurationWorkingDays(
    { start: startDate || null, finish: draftFinish },
    coerceProjectCalendar({
      hoursPerWorkday,
      workdaysPerWeek: Number(workdaysPerWeek),
      nonWorkingDays,
    }),
  );
  const draftDurationLabel =
    draftDuration == null
      ? tCommon('none')
      : !approvedFinish && forecastFinish
        ? t('forecastDurationValue', { count: draftDuration })
        : t('durationValue', { count: draftDuration });
  const hoursLabel = String(project.hoursPerWorkday ?? 8);
  const workdays = project.workdaysPerWeek ?? 5;
  const holidayList = [...(project.nonWorkingDays ?? [])].sort();

  function pinnedRecordHref(record: PinnedRecord) {
    return recordHref({
      workspaceSlug,
      projectSlug: project.slug,
      recordSlug: record.slug,
    });
  }

  return (
    <>
      <CollapsibleSection
        id="project-baseline"
        storageKey={`project:${projectId}:baseline`}
        title={t('title')}
        defaultOpen
        action={
          canMutate ? (
            <Button type="button" variant="secondary" onClick={openEdit}>
              {t('edit')}
            </Button>
          ) : null
        }
      >
        <div className="grid gap-3">
          <section className="kh-ops-panel">
            <div className="kh-ops-baseline-grid">
              <div className="kh-ops-field-cell">
                <small>{t('startDate')}</small>
                <strong>{dateLabel(project.startDate)}</strong>
              </div>
              <div className="kh-ops-field-cell">
                <small>{t('duration')}</small>
                <strong className="tabular-nums">{durationLabel}</strong>
              </div>
              <div className="kh-ops-field-cell">
                <small>{baselineFinishIsForecast ? t('forecastFinish') : t('baselineFinish')}</small>
                <strong>{dateLabel(baselineFinish)}</strong>
              </div>
              <div className="kh-ops-field-cell">
                <small>{t('forecastFinish')}</small>
                <strong>{dateLabel(forecastFinish)}</strong>
              </div>
              <div className="kh-ops-field-cell">
                <small>{t('hoursPerWorkday')}</small>
                <strong className="tabular-nums">{hoursLabel}</strong>
              </div>
              <div className="kh-ops-field-cell">
                <small>{t('workdaysPerWeek')}</small>
                <strong>
                  {workdays}
                  <span className="kh-ops-menu-type text-ink-muted">
                    {' '}
                    · {t(`workweek.${workdays}`)}
                  </span>
                </strong>
              </div>
              <div className="kh-ops-field-cell">
                <small>{t('currency')}</small>
                <strong>{currencyCode}</strong>
              </div>
              <div className="kh-ops-field-cell">
                <small>{t('initialBudget')}</small>
                <strong>
                  <span className="tabular-nums">{formatMoney(
                    Number.isFinite(initialBudgetNumber as number)
                      ? (initialBudgetNumber as number)
                      : null,
                    currencyCode,
                    locale,
                  )}</span>
                </strong>
              </div>
              <div className="kh-ops-field-cell">
                <small>{t('keyPrefix')}</small>
                <strong>
                  {project.keyPrefix ? (
                    <span className="kh-ops-key-badge">{project.keyPrefix}</span>
                  ) : (
                    tCommon('none')
                  )}
                </strong>
              </div>
              <div className="kh-ops-field-cell">
                <small>{t('scheduleSlipTitle')}</small>
                <strong>
                  {project.scheduleSlipRiskEnabled ? t('scheduleSlipOn') : t('scheduleSlipOff')}
                </strong>
              </div>
              <div className="kh-ops-field-cell">
                <small>{t('scheduleSlipThreshold')}</small>
                <strong className="tabular-nums">{project.scheduleSlipThresholdDays ?? 2}</strong>
              </div>
              <div className="kh-ops-field-cell">
                <small>{t('scheduleSlipTypes')}</small>
                <strong>
                  {(project.scheduleSlipItemTypes ?? [...SLIP_TYPES])
                    .map((type) => t(`scheduleSlipType.${type}`))
                    .join(', ') || tCommon('none')}
                </strong>
              </div>
            </div>
            <div className="border-t border-line">
              <div className="kh-ops-panel-head">
                <h3 className="kh-ops-menu-type m-0">{t('definitionOfDone')}</h3>
              </div>
              <p className="kh-ops-menu-type m-0 whitespace-pre-wrap px-3.5 py-3">
                {project.definitionOfDone?.trim() || tCommon('none')}
              </p>
            </div>
            <div className="border-t border-line">
              <div className="kh-ops-panel-head">
                <h3 className="kh-ops-menu-type m-0">{t('nonWorkingDays')}</h3>
              </div>
              {holidayList.length === 0 ? (
                <p className="kh-ops-menu-type m-0 px-3.5 py-3 text-ink-muted">
                  {tCommon('none')}
                </p>
              ) : (
                <ul className="m-0 grid list-none gap-0 p-0">
                  {holidayList.map((day) => (
                    <li
                      key={day}
                      className="kh-ops-menu-type border-b border-line px-3.5 py-2 last:border-b-0"
                    >
                      {dateLabel(day)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section className="kh-ops-panel">
            <div className="kh-ops-panel-head">
              <h2 className="kh-ops-panel-title">{t('pinnedRecords')}</h2>
            </div>
            {project.charterRecord ? (
              <div className="kh-ops-pinned">
                <span className="kh-ops-code-box">CH</span>
                <div>
                  <h3>
                    {project.charterRecord.humanKey ? (
                      <span className="kh-ops-key-badge mr-2">
                        {project.charterRecord.humanKey}
                      </span>
                    ) : null}
                    <Link
                      href={pinnedRecordHref(project.charterRecord)}
                      className="text-inherit no-underline hover:underline"
                    >
                      {project.charterRecord.title}
                    </Link>
                  </h3>
                  <p>{t('charter')}</p>
                </div>
                <Badge>{t('pinnedBadge')}</Badge>
              </div>
            ) : (
              <div className="kh-ops-pinned">
                <span className="kh-ops-code-box">CH</span>
                <div>
                  <h3>{t('charter')}</h3>
                  <p>{tCommon('none')}</p>
                </div>
              </div>
            )}
            {project.initialPlanRecord ? (
              <div className="kh-ops-pinned">
                <span className="kh-ops-code-box">PL</span>
                <div>
                  <h3>
                    {project.initialPlanRecord.humanKey ? (
                      <span className="kh-ops-key-badge mr-2">
                        {project.initialPlanRecord.humanKey}
                      </span>
                    ) : null}
                    <Link
                      href={pinnedRecordHref(project.initialPlanRecord)}
                      className="text-inherit no-underline hover:underline"
                    >
                      {project.initialPlanRecord.title}
                    </Link>
                  </h3>
                  <p>{t('initialPlan')}</p>
                </div>
                <Badge>{t('pinnedBadge')}</Badge>
              </div>
            ) : (
              <div className="kh-ops-pinned">
                <span className="kh-ops-code-box">PL</span>
                <div>
                  <h3>{t('initialPlan')}</h3>
                  <p>{tCommon('none')}</p>
                </div>
              </div>
            )}
          </section>

          <section className="kh-ops-panel">
            <div className="kh-ops-panel-head">
              <h2 className="kh-ops-panel-title">{t('initialStakeholders')}</h2>
            </div>
            {stakeholders.length === 0 ? (
              <p className="kh-ops-empty">{t('noInitialStakeholders')}</p>
            ) : (
              <div className="kh-ops-table-wrap">
                <table className="kh-ops-data-table">
                  <thead>
                    <tr>
                      <th>{t('colPerson')}</th>
                      <th>{t('colRole')}</th>
                      <th>{t('colEmail')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stakeholders.map((row) => (
                      <tr key={row.id}>
                        <td className="kh-ops-primary-cell">{row.displayName}</td>
                        <td>
                          <Badge tone="brand">
                            {tStakeholders(`projectRole.${row.projectRole}`)}
                          </Badge>
                        </td>
                        <td>{row.email}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <p className="m-0 text-xs text-ink-muted">
            {canMutate ? t('hint') : t('readOnlyHint')}
          </p>
        </div>
      </CollapsibleSection>

      <Modal
        open={editOpen}
        onClose={() => {
          setPrefixConfirm(null);
          setEditOpen(false);
        }}
        title={prefixConfirm ? t('keyPrefixConfirmTitle') : t('editTitle')}
        description={prefixConfirm ? undefined : t('editDescription')}
        size={DELIVERY_ITEM_MODAL_SIZE}
        closeOnEscape={!pickerOpen}
        footer={
          prefixConfirm ? (
            <>
              <Button
                type="button"
                variant="secondary"
                disabled={pending}
                onClick={() => setPrefixConfirm(null)}
              >
                {tCommon('back')}
              </Button>
              <Button
                type="button"
                disabled={pending}
                onClick={() => {
                  const thresholdDays = Number(slipThreshold);
                  void persistBaseline(thresholdDays);
                }}
              >
                {pending ? tCommon('saving') : t('keyPrefixConfirmAction')}
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="secondary"
                disabled={pending}
                onClick={() => setEditOpen(false)}
              >
                {tCommon('cancel')}
              </Button>
              <Button
                type="button"
                disabled={pending}
                onClick={() => void save()}
              >
                {pending ? tCommon('saving') : tCommon('save')}
              </Button>
            </>
          )
        }
      >
        {prefixConfirm ? (
          <div className="grid gap-3">
            {error ? <ErrorText>{error}</ErrorText> : null}
            <p className="kh-ops-menu-type m-0">
              {t('keyPrefixConfirmBody', {
                previous: prefixConfirm.previous,
                next: prefixConfirm.next,
              })}
            </p>
            <section className="grid gap-2">
              <h3 className="kh-ops-menu-type m-0 font-medium">
                {t('keyPrefixMentionsTitle', { previous: prefixConfirm.previous })}
              </h3>
              {prefixConfirm.mentionsFailed ? (
                <p className="kh-ops-menu-type m-0 text-ink-muted">
                  {t('keyPrefixMentionsFailed')}
                </p>
              ) : prefixConfirm.mentions.length === 0 ? (
                <p className="kh-ops-menu-type m-0 text-ink-muted">
                  {t('keyPrefixMentionsEmpty')}
                </p>
              ) : (
                <ul className="m-0 grid list-none gap-2 p-0">
                  {prefixConfirm.mentions.map((mention) => (
                    <li key={mention.id} className="grid gap-1">
                      <Link
                        className="kh-text-link kh-ops-menu-type"
                        href={recordHref({
                          workspaceSlug,
                          projectSlug: mention.projectSlug,
                          recordSlug: mention.slug,
                        })}
                      >
                        {mention.title}
                      </Link>
                      <p className="kh-ops-menu-type m-0 text-ink-muted">{mention.excerpt}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        ) : null}
        <div className={prefixConfirm ? 'hidden' : 'grid gap-3'}>
          {error ? <ErrorText>{error}</ErrorText> : null}
          <div className="kh-ops-form-grid">
            <Field label={t('startDate')}>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                disabled={pending}
                data-modal-initial-focus
              />
            </Field>
            <Field label={t('duration')}>
              <p className="kh-ops-menu-type m-0 min-h-10 py-2 tabular-nums">{draftDurationLabel}</p>
            </Field>
          </div>
          <Field label={baselineFinishIsForecast ? t('forecastFinish') : t('baselineFinish')}>
            <p className="kh-ops-menu-type m-0">{dateLabel(approvedFinish ?? forecastFinish)}</p>
            <p className="kh-ops-menu-type mt-1 mb-0 text-ink-muted">
              {baselineFinishIsForecast ? t('forecastFallbackHint') : t('finishLockedHint')}
            </p>
            {scheduleChanges.length > 0 ? (
              <ul className="m-0 mt-2 grid list-none gap-1 p-0">
                {scheduleChanges.map((change) => (
                  <li key={change.id}>
                    <Link
                      href={`?change=${change.id}#project-change`}
                      className="kh-text-link"
                    >
                      {change.humanKey ? `${change.humanKey} · ` : ''}
                      {change.title}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="kh-ops-menu-type mt-1 mb-0">
                <Link href="#project-change" className="kh-text-link">
                  {t('finishLockedLink')}
                </Link>
              </p>
            )}
          </Field>
          <Field label={t('forecastFinish')}>
            <p className="kh-ops-menu-type m-0">{dateLabel(forecastFinish)}</p>
            <p className="kh-ops-menu-type mt-1 mb-0 text-ink-muted">{t('forecastHint')}</p>
          </Field>
          <div className="kh-ops-form-grid">
            <Field label={t('hoursPerWorkday')}>
              <Input
                type="number"
                min="0.25"
                max="24"
                step="0.25"
                value={hoursPerWorkday}
                onChange={(e) => setHoursPerWorkday(e.target.value)}
                disabled={pending}
              />
            </Field>
            <Field label={t('workdaysPerWeek')}>
              <Select
                value={workdaysPerWeek}
                onChange={(e) => setWorkdaysPerWeek(e.target.value)}
                disabled={pending}
              >
                {[1, 2, 3, 4, 5, 6, 7].map((count) => (
                  <option key={count} value={count}>
                    {count} · {t(`workweek.${count}`)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="grid gap-2">
            <Switch
              checked={slipEnabled}
              onCheckedChange={setSlipEnabled}
              label={t('scheduleSlipEnabled')}
              disabled={pending}
            />
            <Field label={t('scheduleSlipThreshold')}>
              <Input
                type="number"
                min="1"
                max="3650"
                step="1"
                value={slipThreshold}
                onChange={(event) => setSlipThreshold(event.target.value)}
                disabled={pending || !slipEnabled}
              />
            </Field>
            <fieldset className="m-0 grid gap-1 border-0 p-0" disabled={pending || !slipEnabled}>
              <legend className="kh-ops-menu-type mb-1">{t('scheduleSlipTypes')}</legend>
              {SLIP_TYPES.map((type) => (
                <label key={type} className="kh-ops-menu-type flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={slipTypes.includes(type)}
                    onChange={() => {
                      setSlipTypes((current) => (
                        current.includes(type)
                          ? current.filter((item) => item !== type)
                          : [...current, type]
                      ));
                    }}
                  />
                  {t(`scheduleSlipType.${type}`)}
                </label>
              ))}
            </fieldset>
          </div>
          <Field label={t('nonWorkingDays')}>
            <div className="grid gap-2">
              <div className="flex items-end gap-2">
                <Input
                  type="date"
                  value={holidayDraft}
                  onChange={(e) => setHolidayDraft(e.target.value)}
                  disabled={pending}
                  aria-label={t('nonWorkingDay')}
                  className="min-w-0 flex-1"
                />
                <Button
                  type="button"
                  variant={holidayDraft ? 'primary' : 'secondary'}
                  disabled={pending || !holidayDraft}
                  onClick={addNonWorkingDay}
                  className="kh-ops-menu-type shrink-0"
                >
                  {t('addNonWorkingDay')}
                </Button>
              </div>
              {nonWorkingDays.length === 0 ? (
                <p className="kh-ops-menu-type m-0 text-ink-muted">{tCommon('none')}</p>
              ) : (
                <ul className="m-0 grid list-none gap-1 p-0">
                  {nonWorkingDays.map((day) => (
                    <li
                      key={day}
                      className="flex items-center justify-between gap-2"
                    >
                      <span className="kh-ops-menu-type">{dateLabel(day)}</span>
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={pending}
                        onClick={() => removeNonWorkingDay(day)}
                        className="kh-btn-danger-outline kh-ops-menu-type shrink-0"
                      >
                        {t('removeNonWorkingDay')}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="kh-ops-menu-type m-0 text-ink-muted">{t('nonWorkingDaysHint')}</p>
            </div>
          </Field>
          <div className="kh-ops-form-grid">
            <Field label={t('currency')}>
              <Select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                disabled={pending}
              >
                {PROJECT_CURRENCIES.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('initialBudget')}>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={initialBudget}
                onChange={(e) => setInitialBudget(e.target.value)}
                disabled={pending}
                placeholder="0.00"
              />
            </Field>
          </div>
          <Field label={t('keyPrefix')}>
            <Input
              value={keyPrefix}
              onChange={(e) =>
                setKeyPrefix(e.target.value.toUpperCase().slice(0, 3))
              }
              disabled={pending}
              maxLength={3}
              className="kh-ops-key-badge uppercase"
              placeholder={suggestKeyPrefix(
                project.slug || project.name || 'PRJ',
              )}
            />
            <p className="kh-ops-menu-type mt-1 mb-0 text-ink-muted">{t('keyPrefixHint')}</p>
            {canReleasePrefixes ? (
              <div className="mt-3 grid gap-2">
                <p className="kh-ops-menu-type m-0">{t('keyPrefixHistoryTitle')}</p>
                {retiredPrefixes.length === 0 ? (
                  <p className="kh-ops-menu-type m-0 text-ink-muted">
                    {t('keyPrefixHistoryEmpty')}
                  </p>
                ) : (
                  <ul className="m-0 grid list-none gap-2 p-0">
                    {retiredPrefixes.map((row) => (
                      <li
                        key={row.keyPrefix}
                        className="flex items-center justify-between gap-2"
                      >
                        <span className="kh-ops-key-badge">{row.keyPrefix}</span>
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={pending}
                          onClick={() => void releasePrefix(row.keyPrefix)}
                          className="kh-ops-menu-type shrink-0"
                        >
                          {t('keyPrefixRelease')}
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}
          </Field>
          <Field label={t('definitionOfDone')}>
            <Textarea
              value={definitionOfDone}
              onChange={(e) => setDefinitionOfDone(e.target.value)}
              disabled={pending}
              rows={4}
              placeholder={t('definitionOfDonePlaceholder')}
            />
            <p className="mt-1 mb-0 text-xs text-ink-muted">
              {t('definitionOfDoneHint')}
            </p>
          </Field>
          <Field label={t('charter')}>
            <DeliveryDocumentsEditor
              records={preferType(knowledgeRecords, 'project-charter')}
              linkedRecords={pinnedDocument(project.charterRecord)}
              linkedIds={charterRecordId ? [charterRecordId] : []}
              onChange={(ids) => setCharterRecordId(singleRecordId(charterRecordId, ids))}
              canEdit={canMutate}
              disabled={pending}
              onPickerOpenChange={setPickerOpen}
            />
            <p className="mt-1 mb-0 text-xs text-ink-muted">{t('charterPickerHint')}</p>
          </Field>
          <Field label={t('initialPlan')}>
            <DeliveryDocumentsEditor
              records={preferType(knowledgeRecords, 'plan')}
              linkedRecords={pinnedDocument(project.initialPlanRecord)}
              linkedIds={initialPlanRecordId ? [initialPlanRecordId] : []}
              onChange={(ids) => setInitialPlanRecordId(singleRecordId(initialPlanRecordId, ids))}
              canEdit={canMutate}
              disabled={pending}
              onPickerOpenChange={setPickerOpen}
            />
            <p className="mt-1 mb-0 text-xs text-ink-muted">{t('planPickerHint')}</p>
          </Field>
          <Field label={t('initialStakeholders')}>
            <div className="kh-ops-scope-checks max-h-56 overflow-auto">
              {members.length === 0 ? (
                <p className="m-0 text-sm text-ink-muted">{t('noMembers')}</p>
              ) : (
                <ul className="m-0 grid list-none gap-2 p-0">
                  {members.map((member) => {
                    const selected = draftStakeholders.find(
                      (row) => row.userId === member.userId,
                    );
                    return (
                      <li key={member.userId} className="grid gap-1">
                        <label className="flex items-start gap-2 text-sm">
                          <input
                            type="checkbox"
                            className="mt-0.5"
                            checked={Boolean(selected)}
                            disabled={pending}
                            onChange={() => toggleMember(member.userId)}
                          />
                          <span>
                            {member.displayName}{' '}
                            <span className="text-ink-muted">
                              ({member.email})
                            </span>
                          </span>
                        </label>
                        {selected ? (
                          <Select
                            value={selected.projectRole}
                            onChange={(e) =>
                              setMemberRole(member.userId, e.target.value)
                            }
                            disabled={pending}
                            className="ml-6"
                          >
                            {PROJECT_ROLES.map((role) => (
                              <option key={role} value={role}>
                                {tStakeholders(`projectRole.${role}`)}
                              </option>
                            ))}
                          </Select>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </Field>
        </div>
      </Modal>
    </>
  );
}
