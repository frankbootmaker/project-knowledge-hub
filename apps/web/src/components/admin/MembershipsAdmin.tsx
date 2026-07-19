'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Badge, Button, ErrorText, Field, Panel, Select } from '../ui';

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
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [userId, setUserId] = useState(users[0]?.id ?? '');
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.id ?? '');
  const [role, setRole] = useState<(typeof ROLES)[number]>('reader');

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
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('failed'));
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
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('failed'));
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
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: { message?: string } };
        throw new Error(payload.error?.message ?? t('failed'));
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('failed'));
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
      <Panel>
        <h2 className="mt-0 mb-4 text-lg font-semibold">{t('addMembership')}</h2>
        <div className="grid gap-4">
          <Field label={t('user')}>
            <Select value={userId} onChange={(e) => setUserId(e.target.value)}>
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
          <Button
            type="button"
            disabled={pending || !userId || !workspaceId}
            onClick={() => void createMembership()}
          >
            {t('create')}
          </Button>
        </div>
      </Panel>

      <div className="grid gap-3">
        {initialMemberships.length === 0 ? (
          <p className="kh-muted">{t('emptyMemberships')}</p>
        ) : (
          initialMemberships.map((membership) => (
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
