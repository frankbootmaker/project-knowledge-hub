'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  RACI_ROLES,
  raciDraftIssues,
  type RaciDraftIssue,
  type RaciRole,
} from '../lib/raci-draft';
import { Button, Input, Modal, Select } from './ui';

const PAGE_SIZES = [5, 10, 25, 50] as const;
type PageSize = (typeof PAGE_SIZES)[number];

const ROLE_ORDER: Record<RaciRole, number> = { A: 0, R: 1, C: 2, I: 3 };

export type RaciAssignment = {
  userId: string;
  displayName: string;
  email: string;
  role: RaciRole;
};

export type RaciMemberOption = {
  userId: string;
  displayName: string;
  email: string;
};

type StakeholderRow = {
  kind: string;
  userId: string | null;
  displayName: string;
  email: string | null;
  jobTitle: string | null;
  projectRole: string | null;
};

type PersonOption = {
  userId: string;
  displayName: string;
  email: string;
  detail: string | null;
};

function isPageSize(value: number): value is PageSize {
  return (PAGE_SIZES as readonly number[]).includes(value);
}

function isRaciRole(value: string): value is RaciRole {
  return (RACI_ROLES as readonly string[]).includes(value);
}

export async function saveDeliveryRaci(input: {
  taskId: string;
  entries: Array<{ userId: string; role: RaciRole }>;
}): Promise<RaciAssignment[]> {
  const response = await fetch(`/api/v1/project-tasks/${input.taskId}/raci`, {
    method: 'PUT',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Origin: window.location.origin,
    },
    body: JSON.stringify({
      entries: input.entries.map((entry) => ({
        userId: entry.userId,
        role: entry.role,
      })),
    }),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    task?: { raci?: RaciAssignment[] };
    error?: { message?: string };
  };
  if (!response.ok || !payload.task?.raci) {
    throw new Error(payload.error?.message || 'Failed to update RACI');
  }
  return payload.task.raci;
}

function personOptions(
  stakeholders: StakeholderRow[],
  members: RaciMemberOption[],
): PersonOption[] {
  const byId = new Map<string, PersonOption>();
  for (const member of members) {
    byId.set(member.userId, {
      userId: member.userId,
      displayName: member.displayName,
      email: member.email,
      detail: null,
    });
  }
  for (const row of stakeholders) {
    if (row.kind !== 'person' || !row.userId) continue;
    const existing = byId.get(row.userId);
    byId.set(row.userId, {
      userId: row.userId,
      displayName: row.displayName,
      email: row.email ?? existing?.email ?? '',
      detail: row.jobTitle || row.projectRole,
    });
  }
  return [...byId.values()].sort((left, right) =>
    left.displayName.localeCompare(right.displayName),
  );
}

export function DeliveryRaciEditor({
  projectId,
  entries,
  members,
  canEdit,
  disabled = false,
  onChange,
  onPickerOpenChange,
}: {
  projectId: string;
  entries: RaciAssignment[];
  members: RaciMemberOption[];
  canEdit: boolean;
  disabled?: boolean;
  onChange: (entries: RaciAssignment[]) => void;
  onPickerOpenChange?: (open: boolean) => void;
}) {
  const t = useTranslations('delivery');
  const tCommon = useTranslations('common');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [stakeholders, setStakeholders] = useState<StakeholderRow[]>([]);
  const [query, setQuery] = useState('');
  const [addRole, setAddRole] = useState<RaciRole>('A');
  const [addIds, setAddIds] = useState<string[]>([]);
  const [removeIds, setRemoveIds] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(5);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const editable = canEdit && !disabled;
  const issues = editable ? raciDraftIssues(entries) : [];
  const hasAccountable = entries.some((entry) => entry.role === 'A');
  const ordered = [...entries].sort((left, right) => {
    const byRole = ROLE_ORDER[left.role] - ROLE_ORDER[right.role];
    if (byRole !== 0) return byRole;
    return left.displayName.localeCompare(right.displayName);
  });

  function roleLabel(role: RaciRole): string {
    if (role === 'A') return t('raciRoleA');
    if (role === 'R') return t('raciRoleR');
    if (role === 'C') return t('raciRoleC');
    return t('raciRoleI');
  }

  function issueLabel(issue: RaciDraftIssue): string {
    if (issue === 'exactly_one_accountable') return t('raciExactlyOne');
    if (issue === 'duplicate_person_role') return t('raciDuplicateRole');
    return t('raciDuplicatePerson');
  }

  function setOpen(open: boolean) {
    setPickerOpen(open);
    onPickerOpenChange?.(open);
    if (!open) return;
    setQuery('');
    setAddIds([]);
    setPage(1);
    setPickerError(null);
    setAddRole(hasAccountable ? 'R' : 'A');
  }

  async function openPicker() {
    setOpen(true);
    const response = await fetch(`/api/v1/projects/${projectId}/stakeholders`, {
      credentials: 'include',
    });
    const payload = (await response.json().catch(() => ({}))) as {
      stakeholders?: StakeholderRow[];
      error?: { message?: string };
    };
    if (!response.ok) {
      setStakeholders([]);
      if (members.length === 0) {
        setPickerError(payload.error?.message || t('raciFailed'));
      }
      return;
    }
    setStakeholders(payload.stakeholders ?? []);
  }

  function changeRole(userId: string, role: RaciRole) {
    const current = entries.find((entry) => entry.userId === userId);
    if (!current || current.role === role) return;
    if (
      role === 'A' &&
      entries.some((entry) => entry.role === 'A' && entry.userId !== userId)
    ) {
      setNotice(t('raciAccountableTaken'));
      return;
    }
    setNotice(null);
    onChange(
      entries.map((entry) =>
        entry.userId === userId ? { ...entry, role } : entry,
      ),
    );
  }

  const assigned = new Set(entries.map((entry) => entry.userId));
  const catalog = personOptions(stakeholders, members);
  const needle = query.trim().toLowerCase();
  const available = catalog.filter((person) => {
    if (assigned.has(person.userId)) return false;
    if (!needle) return true;
    return `${person.displayName} ${person.email} ${person.detail ?? ''}`
      .toLowerCase()
      .includes(needle);
  });
  const totalPages = Math.max(1, Math.ceil(available.length / pageSize) || 1);
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const pageStart = (currentPage - 1) * pageSize;
  const pageItems = available.slice(pageStart, pageStart + pageSize);
  const addWouldDuplicateAccountable =
    addRole === 'A' && (hasAccountable || addIds.length > 1);
  const addBlocked = addIds.length === 0 || addWouldDuplicateAccountable;

  return (
    <>
      <div className="grid gap-3">
        {editable ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="secondary" onClick={() => void openPicker()}>
              {t('raciAdd')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={removeIds.length === 0}
              onClick={() => {
                setNotice(null);
                onChange(entries.filter((entry) => !removeIds.includes(entry.userId)));
                setRemoveIds([]);
              }}
            >
              {t('raciRemove')}
            </Button>
          </div>
        ) : null}
        {ordered.length === 0 ? (
          <p className="m-0 text-sm text-ink-muted">{t('noRaci')}</p>
        ) : (
          <ul className="m-0 grid list-none gap-2 p-0">
            {ordered.map((entry) => {
              const otherAccountable = entries.some(
                (row) => row.role === 'A' && row.userId !== entry.userId,
              );
              return (
                <li key={entry.userId} className="kh-ops-linked-row">
                  <span className="flex min-w-0 items-start gap-2">
                    {editable ? (
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={removeIds.includes(entry.userId)}
                        onChange={() => {
                          setRemoveIds((prev) =>
                            prev.includes(entry.userId)
                              ? prev.filter((id) => id !== entry.userId)
                              : [...prev, entry.userId],
                          );
                        }}
                        aria-label={t('raciSelect', { name: entry.displayName })}
                      />
                    ) : null}
                    <span className="min-w-0">
                      {entry.displayName}
                      {entry.email ? (
                        <span className="text-ink-muted"> · {entry.email}</span>
                      ) : null}
                    </span>
                  </span>
                  {editable ? (
                    <Select
                      value={entry.role}
                      aria-label={t('raciChangeRole', { name: entry.displayName })}
                      onChange={(event) => {
                        const next = event.target.value;
                        if (isRaciRole(next)) changeRole(entry.userId, next);
                      }}
                      className="h-10 min-h-10 w-auto min-w-[9rem] py-1.5 text-xs"
                    >
                      {RACI_ROLES.map((role) => (
                        <option
                          key={role}
                          value={role}
                          disabled={role === 'A' && otherAccountable}
                        >
                          {roleLabel(role)}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <span className="text-sm text-ink-muted">{roleLabel(entry.role)}</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {notice ? <p className="m-0 text-sm text-danger">{notice}</p> : null}
        {issues.map((issue) => (
          <p key={issue} className="m-0 text-sm text-danger">
            {issueLabel(issue)}
          </p>
        ))}
      </div>
      <Modal
        open={pickerOpen}
        onClose={() => setOpen(false)}
        size="wide"
        title={t('raciAddTitle')}
        description={t('raciAddDescription')}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {tCommon('cancel')}
            </Button>
            <Button
              type="button"
              disabled={addBlocked}
              onClick={() => {
                const picked = catalog.filter((person) => addIds.includes(person.userId));
                onChange([
                  ...entries,
                  ...picked.map((person) => ({
                    userId: person.userId,
                    displayName: person.displayName,
                    email: person.email,
                    role: addRole,
                  })),
                ]);
                setNotice(null);
                setOpen(false);
              }}
            >
              {t('raciAddConfirm')}
            </Button>
          </>
        }
      >
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
              placeholder={t('raciSearch')}
              data-modal-initial-focus
              className="min-w-[12rem] flex-1"
            />
            <Select
              value={addRole}
              aria-label={t('raciRole')}
              onChange={(event) => {
                const next = event.target.value;
                if (isRaciRole(next)) setAddRole(next);
              }}
              className="h-10 min-h-10 w-auto min-w-[9rem] py-1.5 text-xs"
            >
              {RACI_ROLES.map((role) => (
                <option key={role} value={role} disabled={role === 'A' && hasAccountable}>
                  {roleLabel(role)}
                </option>
              ))}
            </Select>
          </div>
          {pickerError ? <p className="m-0 text-sm text-danger">{pickerError}</p> : null}
          {addWouldDuplicateAccountable ? (
            <p className="m-0 text-sm text-danger">
              {hasAccountable ? t('raciAccountableTaken') : t('raciExactlyOne')}
            </p>
          ) : null}
          {available.length === 0 ? (
            <p className="m-0 text-sm text-ink-muted">
              {t(
                needle
                  ? 'raciNoneToAdd'
                  : catalog.length === 0
                    ? 'raciPeopleEmpty'
                    : 'raciAllAssigned',
              )}
            </p>
          ) : (
            <>
              <ul className="m-0 grid list-none gap-2 p-0">
                {pageItems.map((person) => (
                  <li key={person.userId}>
                    <label className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={addIds.includes(person.userId)}
                        onChange={() => {
                          setAddIds((prev) =>
                            prev.includes(person.userId)
                              ? prev.filter((id) => id !== person.userId)
                              : [...prev, person.userId],
                          );
                        }}
                      />
                      <span>
                        {person.displayName}
                        {person.email ? (
                          <span className="text-ink-muted"> · {person.email}</span>
                        ) : null}
                        {person.detail ? (
                          <span className="text-ink-muted"> · {person.detail}</span>
                        ) : null}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
                <p className="m-0 text-xs text-ink-muted">
                  {t('raciShowing', {
                    from: available.length === 0 ? 0 : pageStart + 1,
                    to: Math.min(pageStart + pageSize, available.length),
                    total: available.length,
                  })}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Select
                    value={String(pageSize)}
                    onChange={(event) => {
                      const parsed = Number(event.target.value);
                      setPageSize(isPageSize(parsed) ? parsed : 5);
                      setPage(1);
                    }}
                    aria-label={t('raciPageSize')}
                    className="h-10 min-h-10 w-auto min-w-[9rem] py-1.5 text-xs"
                  >
                    {PAGE_SIZES.map((size) => (
                      <option key={size} value={String(size)}>
                        {t('raciPageSizeOption', { count: size })}
                      </option>
                    ))}
                  </Select>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={currentPage <= 1}
                    onClick={() => setPage(Math.max(1, currentPage - 1))}
                  >
                    {t('raciPrevPage')}
                  </Button>
                  <span className="text-xs text-ink-muted">
                    {currentPage} / {totalPages}
                  </span>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={currentPage >= totalPages}
                    onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
                  >
                    {t('raciNextPage')}
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </Modal>
    </>
  );
}
