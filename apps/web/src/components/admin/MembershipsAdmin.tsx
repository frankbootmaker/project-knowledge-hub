'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  Badge,
  Button,
  ErrorText,
  Field,
  FunctionHeader,
  Input,
  Modal,
  Panel,
  Select,
  useToast,
} from '../ui';

export type PublicMembership = {
  id: string;
  userId: string;
  workspaceId: string;
  role: string;
  createdAt: string;
  user: { id: string; email: string; displayName: string };
  workspace: {
    id: string;
    name: string;
    slug: string;
    organizationId: string;
  };
};

type UserOption = { id: string; email: string; displayName: string };
type WorkspaceOption = { id: string; name: string; slug: string };

const ROLES = ['workspace_admin', 'maintainer', 'reader'] as const;
type RoleFilter = 'all' | (typeof ROLES)[number];

function matchesMembershipSearch(membership: PublicMembership, query: string): boolean {
  if (!query) return true;
  const haystack = [
    membership.user.displayName,
    membership.user.email,
    membership.workspace.name,
    membership.workspace.slug,
    membership.role,
  ]
    .join(' ')
    .toLowerCase();
  return haystack.includes(query);
}

type MembershipUserGroup = {
  userId: string;
  displayName: string;
  email: string;
  memberships: PublicMembership[];
};

function groupMembershipsByUser(items: PublicMembership[]): MembershipUserGroup[] {
  const byUser = new Map<string, MembershipUserGroup>();
  for (const membership of items) {
    const existing = byUser.get(membership.userId);
    if (existing) {
      existing.memberships.push(membership);
      continue;
    }
    byUser.set(membership.userId, {
      userId: membership.userId,
      displayName: membership.user.displayName,
      email: membership.user.email,
      memberships: [membership],
    });
  }

  return Array.from(byUser.values())
    .map((group) => ({
      ...group,
      memberships: [...group.memberships].sort((a, b) =>
        a.workspace.name.localeCompare(b.workspace.name),
      ),
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export function MembershipsAdmin({
  initialMemberships,
  users,
  workspaces,
}: {
  initialMemberships: PublicMembership[];
  users: UserOption[];
  workspaces: WorkspaceOption[];
}) {
  const t = useTranslations('admin');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const { pushToast } = useToast();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  /** When set, create modal locks the user and only offers workspaces they are not already in. */
  const [lockedUserId, setLockedUserId] = useState<string | null>(null);
  const [userId, setUserId] = useState(users[0]?.id ?? '');
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.id ?? '');
  const [role, setRole] = useState<(typeof ROLES)[number]>('reader');
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');

  const filteredMemberships = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return initialMemberships.filter((membership) => {
      if (roleFilter !== 'all' && membership.role !== roleFilter) return false;
      return matchesMembershipSearch(membership, query);
    });
  }, [initialMemberships, searchQuery, roleFilter]);

  const groupedMemberships = useMemo(
    () => groupMembershipsByUser(filteredMemberships),
    [filteredMemberships],
  );

  const availableWorkspaces = useMemo(() => {
    if (!lockedUserId) {
      return workspaces;
    }
    const taken = new Set(
      initialMemberships
        .filter((membership) => membership.userId === lockedUserId)
        .map((membership) => membership.workspaceId),
    );
    return workspaces.filter((workspace) => !taken.has(workspace.id));
  }, [initialMemberships, lockedUserId, workspaces]);

  const lockedUserLabel = useMemo(() => {
    if (!lockedUserId) return '';
    const fromUsers = users.find((user) => user.id === lockedUserId);
    if (fromUsers) {
      return `${fromUsers.displayName} (${fromUsers.email})`;
    }
    const fromMembership = initialMemberships.find(
      (membership) => membership.userId === lockedUserId,
    );
    if (fromMembership) {
      return `${fromMembership.user.displayName} (${fromMembership.user.email})`;
    }
    return lockedUserId;
  }, [initialMemberships, lockedUserId, users]);

  function closeCreateModal() {
    setCreateOpen(false);
    setLockedUserId(null);
    setError(null);
    setUserId(users[0]?.id ?? '');
    setWorkspaceId(workspaces[0]?.id ?? '');
    setRole('reader');
  }

  function openCreateModal() {
    setError(null);
    setLockedUserId(null);
    setUserId(users[0]?.id ?? '');
    setWorkspaceId(workspaces[0]?.id ?? '');
    setRole('reader');
    setCreateOpen(true);
  }

  function openAddWorkspaceForUser(targetUserId: string) {
    const taken = new Set(
      initialMemberships
        .filter((membership) => membership.userId === targetUserId)
        .map((membership) => membership.workspaceId),
    );
    const remaining = workspaces.filter((workspace) => !taken.has(workspace.id));
    if (remaining.length === 0) {
      pushToast(t('membershipNoWorkspacesLeft'), 'info');
      return;
    }
    setError(null);
    setLockedUserId(targetUserId);
    setUserId(targetUserId);
    setWorkspaceId(remaining[0]?.id ?? '');
    setRole('reader');
    setCreateOpen(true);
  }

  async function createMembership() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/v1/memberships', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, workspaceId, role }),
      });
      const payload = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? t('failed'));
      }
      closeCreateModal();
      pushToast(t('toastMembershipCreated'));
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : t('failed');
      setError(message);
      pushToast(message, 'danger');
    } finally {
      setPending(false);
    }
  }

  async function updateRole(membershipId: string, nextRole: string) {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/memberships/${membershipId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: nextRole }),
      });
      const payload = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? t('failed'));
      }
      pushToast(t('toastMembershipUpdated'));
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : t('failed');
      setError(message);
      pushToast(message, 'danger');
    } finally {
      setPending(false);
    }
  }

  async function removeMembership(membershipId: string) {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/memberships/${membershipId}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { Origin: window.location.origin },
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: { message?: string } };
        throw new Error(payload.error?.message ?? t('failed'));
      }
      pushToast(t('toastMembershipRemoved'));
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : t('failed');
      setError(message);
      pushToast(message, 'danger');
    } finally {
      setPending(false);
    }
  }

  function roleLabel(value: string) {
    if (value === 'workspace_admin') return t('roleWorkspaceAdmin');
    if (value === 'maintainer') return t('roleMaintainer');
    if (value === 'reader') return t('roleReader');
    return value;
  }

  return (
    <div className="grid gap-6">
      <FunctionHeader
        search={
          <Input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('membershipsSearchPlaceholder')}
            aria-label={t('membershipsSearchPlaceholder')}
          />
        }
        filters={
          <Select
            value={roleFilter}
            onChange={(e) =>
              setRoleFilter(e.target.value as RoleFilter)
            }
            aria-label={t('membershipsFilterRole')}
          >
            <option value="all">{t('membershipsFilterAll')}</option>
            <option value="workspace_admin">{t('roleWorkspaceAdmin')}</option>
            <option value="maintainer">{t('roleMaintainer')}</option>
            <option value="reader">{t('roleReader')}</option>
          </Select>
        }
        actions={
          <Button
            type="button"
            disabled={pending || users.length === 0 || workspaces.length === 0}
            onClick={openCreateModal}
          >
            {t('addMembership')}
          </Button>
        }
      />

      <Modal
        open={createOpen}
        onClose={closeCreateModal}
        title={lockedUserId ? t('addUserToWorkspace') : t('addMembership')}
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={closeCreateModal}
            >
              {tCommon('cancel')}
            </Button>
            <Button
              type="button"
              disabled={pending || !userId || !workspaceId || availableWorkspaces.length === 0}
              onClick={() => void createMembership()}
            >
              {t('create')}
            </Button>
          </>
        }
      >
        {lockedUserId ? (
          <Field label={t('user')}>
            <Input
              value={lockedUserLabel}
              readOnly
              disabled
              data-modal-initial-focus
            />
          </Field>
        ) : (
          <Field label={t('user')}>
            <Select
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              data-modal-initial-focus
            >
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.displayName} ({user.email})
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label={t('workspace')}>
          {availableWorkspaces.length === 0 ? (
            <p className="m-0 text-sm text-ink-muted">{t('membershipNoWorkspacesLeft')}</p>
          ) : (
            <Select value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)}>
              {availableWorkspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('role')}>
          <Select
            value={role}
            onChange={(e) => setRole(e.target.value as (typeof ROLES)[number])}
          >
            {ROLES.map((value) => (
              <option key={value} value={value}>
                {roleLabel(value)}
              </option>
            ))}
          </Select>
        </Field>
        {error ? <ErrorText>{error}</ErrorText> : null}
      </Modal>

      <div className="grid gap-3">
        {groupedMemberships.length === 0 ? (
          <p className="kh-muted">
            {initialMemberships.length === 0
              ? t('emptyMemberships')
              : t('emptyMembershipsFiltered')}
          </p>
        ) : (
          groupedMemberships.map((group) => {
            const takenCount = initialMemberships.filter(
              (membership) => membership.userId === group.userId,
            ).length;
            const canAddWorkspace = takenCount < workspaces.length;

            return (
              <Panel key={group.userId} className="grid gap-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <strong>{group.displayName}</strong>
                      <Badge tone="neutral">
                        {t('membershipWorkspaceCount', {
                          count: group.memberships.length,
                        })}
                      </Badge>
                    </div>
                    <p className="mt-1 mb-0 text-sm text-ink-muted">{group.email}</p>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={pending || !canAddWorkspace}
                    onClick={() => openAddWorkspaceForUser(group.userId)}
                  >
                    {t('addUserToWorkspace')}
                  </Button>
                </div>
                <ul className="m-0 grid list-none gap-2 p-0">
                  {group.memberships.map((membership) => (
                    <li
                      key={membership.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-panel-solid px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="m-0 font-medium text-ink">
                          {membership.workspace.name}
                        </p>
                        <p className="m-0 text-xs text-ink-muted">
                          {membership.workspace.slug}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Select
                          className="w-auto"
                          value={membership.role}
                          disabled={pending}
                          aria-label={t('role')}
                          onChange={(e) =>
                            void updateRole(membership.id, e.target.value)
                          }
                        >
                          {ROLES.map((value) => (
                            <option key={value} value={value}>
                              {roleLabel(value)}
                            </option>
                          ))}
                        </Select>
                        <Button
                          type="button"
                          variant="danger"
                          disabled={pending}
                          onClick={() => void removeMembership(membership.id)}
                        >
                          {t('remove')}
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </Panel>
            );
          })
        )}
      </div>
    </div>
  );
}
