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

  function closeCreateModal() {
    setCreateOpen(false);
    setError(null);
    setUserId(users[0]?.id ?? '');
    setWorkspaceId(workspaces[0]?.id ?? '');
    setRole('reader');
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
            onClick={() => {
              setError(null);
              setUserId(users[0]?.id ?? '');
              setWorkspaceId(workspaces[0]?.id ?? '');
              setRole('reader');
              setCreateOpen(true);
            }}
          >
            {t('addMembership')}
          </Button>
        }
      />

      <Modal
        open={createOpen}
        onClose={closeCreateModal}
        title={t('addMembership')}
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
              disabled={pending || !userId || !workspaceId}
              onClick={() => void createMembership()}
            >
              {t('create')}
            </Button>
          </>
        }
      >
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
        <Field label={t('workspace')}>
          <Select value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)}>
            {workspaces.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.name}
              </option>
            ))}
          </Select>
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
        {filteredMemberships.length === 0 ? (
          <p className="kh-muted">
            {initialMemberships.length === 0
              ? t('emptyMemberships')
              : t('emptyMembershipsFiltered')}
          </p>
        ) : (
          filteredMemberships.map((membership) => (
            <Panel
              key={membership.id}
              className="flex flex-wrap items-center justify-between gap-3"
            >
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <strong>{membership.user.displayName}</strong>
                  <Badge>{roleLabel(membership.role)}</Badge>
                </div>
                <p className="mt-1 mb-0 text-sm text-ink-muted">
                  {membership.user.email} · {membership.workspace.name}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  className="w-auto"
                  value={membership.role}
                  disabled={pending}
                  onChange={(e) => void updateRole(membership.id, e.target.value)}
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
            </Panel>
          ))
        )}
      </div>
    </div>
  );
}
