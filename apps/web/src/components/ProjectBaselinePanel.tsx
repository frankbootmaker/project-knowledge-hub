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
        <dl className="m-0 grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-ink-muted">
              {t('startDate')}
            </dt>
            <dd className="m-0 mt-1 text-sm text-ink">
              {project.startDate || tCommon('none')}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-ink-muted">
              {t('endDate')}
            </dt>
            <dd className="m-0 mt-1 text-sm text-ink">
              {project.endDate || tCommon('none')}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-ink-muted">
              {t('currency')}
            </dt>
            <dd className="m-0 mt-1 text-sm text-ink">{currencyCode}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-ink-muted">
              {t('initialBudget')}
            </dt>
            <dd className="m-0 mt-1 text-sm text-ink">
              {formatMoney(
                Number.isFinite(initialBudgetNumber as number)
                  ? (initialBudgetNumber as number)
                  : null,
                currencyCode,
                locale,
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-ink-muted">
              {t('keyPrefix')}
            </dt>
            <dd className="m-0 mt-1 font-mono text-sm text-ink">
              {project.keyPrefix || tCommon('none')}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-ink-muted">
              {t('charter')}
            </dt>
            <dd className="m-0 mt-1 text-sm">
              {project.charterRecord ? (
                <Link
                  href={recordHref(project.charterRecord)}
                  className="text-brand no-underline hover:text-brand-hover"
                >
                  {project.charterRecord.title}
                </Link>
              ) : (
                <span className="text-ink-muted">{tCommon('none')}</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-ink-muted">
              {t('initialPlan')}
            </dt>
            <dd className="m-0 mt-1 text-sm">
              {project.initialPlanRecord ? (
                <Link
                  href={recordHref(project.initialPlanRecord)}
                  className="text-brand no-underline hover:text-brand-hover"
                >
                  {project.initialPlanRecord.title}
                </Link>
              ) : (
                <span className="text-ink-muted">{tCommon('none')}</span>
              )}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs font-medium uppercase tracking-wide text-ink-muted">
              {t('definitionOfDone')}
            </dt>
            <dd className="m-0 mt-1 whitespace-pre-wrap text-sm text-ink">
              {project.definitionOfDone?.trim() || tCommon('none')}
            </dd>
          </div>
        </dl>

        <div className="mt-4">
          <p className="m-0 mb-2 text-xs font-medium uppercase tracking-wide text-ink-muted">
            {t('initialStakeholders')}
          </p>
          {stakeholders.length === 0 ? (
            <p className="m-0 text-sm text-ink-muted">{t('noInitialStakeholders')}</p>
          ) : (
            <ul className="m-0 grid list-none gap-2 p-0">
              {stakeholders.map((row) => (
                <li
                  key={row.id}
                  className="flex flex-wrap items-center gap-2 text-sm"
                >
                  <span className="font-medium">{row.displayName}</span>
                  <Badge tone="brand">
                    {tStakeholders(`projectRole.${row.projectRole}`)}
                  </Badge>
                  <span className="text-ink-muted">{row.email}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <p className="mt-3 mb-0 text-xs text-ink-muted">
          {canMutate ? t('hint') : t('readOnlyHint')}
        </p>
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
