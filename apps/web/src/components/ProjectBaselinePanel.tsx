'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { suggestKeyPrefix } from '@project-knowledge-hub/domain';
import { CollapsibleSection } from './CollapsibleSection';
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
  ErrorText,
  Field,
  Input,
  Modal,
  Select,
  Textarea,
  useToast,
} from './ui';

export type PinnedRecord = {
  id: string;
  title: string;
  slug: string;
  recordType: string;
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

export function ProjectBaselinePanel({
  projectId,
  workspaceSlug,
  canMutate,
  project,
  initialStakeholders,
  members,
  knowledgeRecords,
}: {
  projectId: string;
  workspaceSlug: string;
  canMutate: boolean;
  project: BaselineProject;
  initialStakeholders: InitialStakeholder[];
  members: Member[];
  knowledgeRecords: KnowledgeOption[];
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
  const [draftStakeholders, setDraftStakeholders] = useState<DraftStakeholder[]>(
    [],
  );

  const currencyCode = project.currency ?? 'EUR';
  const initialBudgetNumber =
    project.initialBudget == null || project.initialBudget === ''
      ? null
      : Number(project.initialBudget);

  const charterOptions = useMemo(
    () => knowledgeRecords.filter((row) => row.recordType === 'project-charter'),
    [knowledgeRecords],
  );
  const planOptions = useMemo(
    () => knowledgeRecords.filter((row) => row.recordType === 'plan'),
    [knowledgeRecords],
  );

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
    setDraftStakeholders(
      stakeholders.map((row) => ({
        userId: row.userId,
        projectRole: row.projectRole || 'stakeholder',
      })),
    );
    setError(null);
    setEditOpen(true);
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
    return <LocalDateTime value={value} dateOnly />;
  }

  const durationLabel =
    project.durationWorkingDays == null
      ? tCommon('none')
      : t('durationValue', { count: project.durationWorkingDays });
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
            <div className="kh-ops-panel-head">
              <h2 className="kh-ops-panel-title">{t('fieldsTitle')}</h2>
            </div>
            <div className="kh-ops-baseline-grid">
              <div className="kh-ops-field-cell">
                <small>{t('startDate')}</small>
                <strong>{dateLabel(project.startDate)}</strong>
              </div>
              <div className="kh-ops-field-cell">
                <small>{t('duration')}</small>
                <strong>{durationLabel}</strong>
              </div>
              <div className="kh-ops-field-cell">
                <small>{t('finishDate')}</small>
                <strong>{dateLabel(project.finishDate)}</strong>
              </div>
              <div className="kh-ops-field-cell">
                <small>{t('hoursPerWorkday')}</small>
                <strong>{hoursLabel}</strong>
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
                  {formatMoney(
                    Number.isFinite(initialBudgetNumber as number)
                      ? (initialBudgetNumber as number)
                      : null,
                    currencyCode,
                    locale,
                  )}
                </strong>
              </div>
              <div className="kh-ops-field-cell">
                <small>{t('keyPrefix')}</small>
                <strong>{project.keyPrefix || tCommon('none')}</strong>
              </div>
              <div className="kh-ops-field-cell">
                <small>{t('definitionOfDone')}</small>
                <strong>
                  {project.definitionOfDone?.trim()
                    ? project.definitionOfDone.trim().split('\n')[0]
                    : tCommon('none')}
                </strong>
              </div>
            </div>
            {project.definitionOfDone?.trim() ? (
              <p className="kh-ops-card-body kh-ops-menu-type m-0 whitespace-pre-wrap">
                {project.definitionOfDone}
              </p>
            ) : null}
            <div className="border-t border-line">
              <div className="kh-ops-panel-head">
                <h3 className="kh-ops-panel-title">{t('nonWorkingDays')}</h3>
              </div>
              {holidayList.length === 0 ? (
                <p className="kh-ops-empty">{tCommon('none')}</p>
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
        onClose={() => setEditOpen(false)}
        title={t('editTitle')}
        description={t('editDescription')}
        size="md"
        footer={
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
        }
      >
        <div className="grid gap-3">
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
              <p className="kh-ops-menu-type m-0 min-h-10 py-2">{durationLabel}</p>
            </Field>
          </div>
          <Field label={t('finishDate')}>
            <p className="kh-ops-menu-type m-0">{dateLabel(project.finishDate)}</p>
            <p className="mt-1 mb-0 text-xs text-ink-muted">{t('finishHint')}</p>
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
                  variant="secondary"
                  disabled={pending || !holidayDraft}
                  onClick={addNonWorkingDay}
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
                        variant="ghost"
                        disabled={pending}
                        onClick={() => removeNonWorkingDay(day)}
                      >
                        {t('removeNonWorkingDay')}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="m-0 text-xs text-ink-muted">{t('nonWorkingDaysHint')}</p>
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
              className="font-mono uppercase"
              placeholder={suggestKeyPrefix(
                project.slug || project.name || 'PRJ',
              )}
            />
            <p className="mt-1 mb-0 text-xs text-ink-muted">{t('keyPrefixHint')}</p>
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
            <Select
              value={charterRecordId}
              onChange={(e) => setCharterRecordId(e.target.value)}
              disabled={pending}
            >
              <option value="">{tCommon('none')}</option>
              {charterOptions.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.title}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('initialPlan')}>
            <Select
              value={initialPlanRecordId}
              onChange={(e) => setInitialPlanRecordId(e.target.value)}
              disabled={pending}
            >
              <option value="">{tCommon('none')}</option>
              {planOptions.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.title}
                </option>
              ))}
            </Select>
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
