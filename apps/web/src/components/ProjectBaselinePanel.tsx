'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { suggestKeyPrefix } from '@project-knowledge-hub/domain';
import { CollapsibleSection } from './CollapsibleSection';
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
  const [endDate, setEndDate] = useState(project.endDate ?? '');
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
    setEndDate(project.endDate ?? '');
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
          endDate: endDate || null,
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

  function recordHref(record: PinnedRecord) {
    return `/workspaces/${workspaceSlug}/records/${record.slug}`;
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
                <strong>{project.startDate || tCommon('none')}</strong>
              </div>
              <div className="kh-ops-field-cell">
                <small>{t('endDate')}</small>
                <strong>{project.endDate || tCommon('none')}</strong>
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
              <p className="m-0 whitespace-pre-wrap px-3 py-3 text-xs text-ink-muted">
                {project.definitionOfDone}
              </p>
            ) : null}
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
                      href={recordHref(project.charterRecord)}
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
                      href={recordHref(project.initialPlanRecord)}
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
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('startDate')}>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                disabled={pending}
                data-modal-initial-focus
              />
            </Field>
            <Field label={t('endDate')}>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                disabled={pending}
              />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
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
            <div className="max-h-56 overflow-auto rounded-md border border-line p-2">
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
