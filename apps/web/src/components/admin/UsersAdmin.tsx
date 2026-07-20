'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { evaluatePasswordStrength } from '@project-knowledge-hub/domain';
import {
  Badge,
  Button,
  ErrorText,
  Field,
  Input,
  Modal,
  Panel,
  PasswordInput,
  PasswordStrengthHint,
  Select,
  useToast,
} from '../ui';

export type PublicUser = {
  id: string;
  email: string;
  displayName: string;
  fullName?: string | null;
  status: string;
  isSystemAdmin: boolean;
  idpSource?: string | null;
  idpSubject?: string | null;
  createdAt: string;
};

type WorkspaceOption = { id: string; name: string; slug: string };

type ApproveMembershipRow = {
  workspaceId: string;
  role: 'workspace_admin' | 'maintainer' | 'reader';
};

const ROLES = ['workspace_admin', 'maintainer', 'reader'] as const;

function statusTone(status: string): 'success' | 'warn' | 'danger' | 'neutral' | 'brand' {
  if (status === 'active') return 'success';
  if (status === 'disabled') return 'danger';
  if (status === 'pending_approval') return 'brand';
  if (status === 'pending_email') return 'warn';
  return 'warn';
}

export function UsersAdmin({
  initialUsers,
  workspaces,
}: {
  initialUsers: PublicUser[];
  workspaces: WorkspaceOption[];
}) {
  const t = useTranslations('admin');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const { pushToast } = useToast();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [sendInvite, setSendInvite] = useState(true);
  const [isSystemAdmin, setIsSystemAdmin] = useState(false);

  const [editUser, setEditUser] = useState<PublicUser | null>(null);
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editFullName, setEditFullName] = useState('');
  const [editStatus, setEditStatus] = useState('active');
  const [editIsSystemAdmin, setEditIsSystemAdmin] = useState(false);
  const [editPassword, setEditPassword] = useState('');
  const [editIdpSource, setEditIdpSource] = useState('');
  const [editIdpSubject, setEditIdpSubject] = useState('');
  const [editError, setEditError] = useState<string | null>(null);

  const [approveUser, setApproveUser] = useState<PublicUser | null>(null);
  const [approveRows, setApproveRows] = useState<ApproveMembershipRow[]>([
    { workspaceId: '', role: 'reader' },
  ]);
  const [approveError, setApproveError] = useState<string | null>(null);

  const pendingApproval = useMemo(
    () => initialUsers.filter((user) => user.status === 'pending_approval'),
    [initialUsers],
  );
  const pendingEmail = useMemo(
    () => initialUsers.filter((user) => user.status === 'pending_email'),
    [initialUsers],
  );
  const otherUsers = useMemo(
    () =>
      initialUsers.filter(
        (user) =>
          user.status !== 'pending_approval' && user.status !== 'pending_email',
      ),
    [initialUsers],
  );

  function closeCreateModal() {
    setCreateOpen(false);
    setEmail('');
    setDisplayName('');
    setFullName('');
    setPassword('');
    setSendInvite(true);
    setIsSystemAdmin(false);
    setError(null);
  }

  function openEdit(user: PublicUser) {
    setEditUser(user);
    setEditDisplayName(user.displayName);
    setEditFullName(user.fullName ?? '');
    setEditStatus(user.status);
    setEditIsSystemAdmin(user.isSystemAdmin);
    setEditPassword('');
    setEditIdpSource(user.idpSource ?? '');
    setEditIdpSubject(user.idpSubject ?? '');
    setEditError(null);
  }

  function closeEdit() {
    setEditUser(null);
    setEditPassword('');
    setEditError(null);
  }

  function openApprove(user: PublicUser) {
    setApproveUser(user);
    setApproveRows([
      {
        workspaceId: workspaces[0]?.id ?? '',
        role: 'reader',
      },
    ]);
    setApproveError(null);
  }

  function closeApprove() {
    setApproveUser(null);
    setApproveError(null);
  }

  async function createUser() {
    setPending(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        email,
        displayName,
        fullName: fullName.trim() || null,
        isSystemAdmin,
        sendInvite,
      };
      if (!sendInvite) {
        body.password = password;
      }
      const response = await fetch('/api/v1/users', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Origin: window.location.origin },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as {
        error?: { message?: string };
        mail?: { warning?: string };
      };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? t('failed'));
      }
      pushToast(
        sendInvite
          ? t('toastInviteSent')
          : t('toastUserCreated', { name: displayName.trim() }),
      );
      if (payload.mail?.warning) {
        pushToast(payload.mail.warning, 'info');
      }
      closeCreateModal();
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : t('failed');
      setError(message);
      pushToast(message, 'danger');
    } finally {
      setPending(false);
    }
  }

  async function saveEdit() {
    if (!editUser) return;
    setPending(true);
    setEditError(null);
    try {
      const patch: Record<string, unknown> = {
        displayName: editDisplayName.trim(),
        fullName: editFullName.trim() || null,
        status: editStatus,
        isSystemAdmin: editIsSystemAdmin,
        idpSource: editIdpSource.trim() || null,
        idpSubject: editIdpSubject.trim() || null,
      };
      if (editPassword.trim()) {
        if (!evaluatePasswordStrength(editPassword.trim()).acceptable) {
          setEditError(tCommon('passwordPolicy'));
          setPending(false);
          return;
        }
        patch.password = editPassword.trim();
      }
      const response = await fetch(`/api/v1/users/${editUser.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Origin: window.location.origin },
        body: JSON.stringify(patch),
      });
      const payload = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? t('failed'));
      }
      pushToast(t('toastUserUpdated'));
      closeEdit();
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : t('failed');
      setEditError(message);
      pushToast(message, 'danger');
    } finally {
      setPending(false);
    }
  }

  async function resendInvite(userId: string) {
    setPending(true);
    setEditError(null);
    try {
      const response = await fetch(`/api/v1/users/${userId}/resend-invite`, {
        method: 'POST',
        credentials: 'include',
        headers: { Origin: window.location.origin },
      });
      const payload = (await response.json()) as {
        error?: { message?: string };
        mail?: { warning?: string };
      };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? t('failed'));
      }
      pushToast(t('toastInviteResent'));
      if (payload.mail?.warning) {
        pushToast(payload.mail.warning, 'info');
      }
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : t('failed');
      setEditError(message);
      pushToast(message, 'danger');
    } finally {
      setPending(false);
    }
  }

  async function approvePendingUser() {
    if (!approveUser) return;
    const memberships = approveRows.filter((row) => row.workspaceId);
    if (memberships.length === 0) {
      setApproveError(t('approveNeedsMembership'));
      return;
    }
    const workspaceIds = memberships.map((row) => row.workspaceId);
    if (new Set(workspaceIds).size !== workspaceIds.length) {
      setApproveError(t('approveDuplicateWorkspace'));
      return;
    }

    setPending(true);
    setApproveError(null);
    try {
      const response = await fetch(`/api/v1/users/${approveUser.id}/approve`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Origin: window.location.origin },
        body: JSON.stringify({ memberships }),
      });
      const payload = (await response.json()) as {
        error?: { message?: string };
        mail?: { warning?: string };
      };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? t('approveFailed'));
      }
      pushToast(t('toastUserApproved'));
      if (payload.mail?.warning) {
        pushToast(payload.mail.warning, 'info');
      }
      closeApprove();
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : t('approveFailed');
      setApproveError(message);
      pushToast(message, 'danger');
    } finally {
      setPending(false);
    }
  }

  async function rejectPendingUser(user: PublicUser) {
    if (!window.confirm(t('rejectConfirm', { email: user.email }))) {
      return;
    }
    setPending(true);
    try {
      const response = await fetch(`/api/v1/users/${user.id}/reject`, {
        method: 'POST',
        credentials: 'include',
        headers: { Origin: window.location.origin },
      });
      const payload = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? t('rejectFailed'));
      }
      pushToast(t('toastUserRejected'));
      if (approveUser?.id === user.id) closeApprove();
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : t('rejectFailed');
      pushToast(message, 'danger');
    } finally {
      setPending(false);
    }
  }

  const createReady =
    email.trim().length > 0 &&
    displayName.trim().length > 0 &&
    (sendInvite || evaluatePasswordStrength(password).acceptable);

  const approveReady =
    approveRows.some((row) => row.workspaceId) &&
    workspaces.length > 0;

  function renderUserRow(user: PublicUser, options?: { showApprove?: boolean }) {
    return (
      <Panel key={user.id} className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <strong>{user.displayName}</strong>
            <Badge tone={statusTone(user.status)}>
              {user.status === 'pending_email'
                ? t('statusPendingEmail')
                : user.status === 'pending_approval'
                  ? t('statusPendingApproval')
                  : user.status === 'active'
                    ? t('statusActive')
                    : user.status === 'disabled'
                      ? t('statusDisabled')
                      : user.status === 'invited'
                        ? t('statusInvited')
                        : user.status}
            </Badge>
            {user.isSystemAdmin ? <Badge tone="brand">{t('systemAdmin')}</Badge> : null}
            {user.idpSource ? <Badge tone="neutral">{user.idpSource}</Badge> : null}
          </div>
          <p className="mt-1 mb-0 text-sm text-ink-muted">{user.email}</p>
          {user.fullName ? (
            <p className="mt-0.5 mb-0 text-sm text-ink-muted">{user.fullName}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {options?.showApprove ? (
            <>
              <Button
                type="button"
                disabled={pending || workspaces.length === 0}
                onClick={() => openApprove(user)}
              >
                {t('approveUser')}
              </Button>
              <Button
                type="button"
                variant="danger"
                disabled={pending}
                onClick={() => void rejectPendingUser(user)}
              >
                {t('rejectUser')}
              </Button>
            </>
          ) : null}
          {user.status === 'pending_email' ? (
            <Button
              type="button"
              variant="danger"
              disabled={pending}
              onClick={() => void rejectPendingUser(user)}
            >
              {t('rejectUser')}
            </Button>
          ) : null}
          {user.status === 'invited' ? (
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() => void resendInvite(user.id)}
            >
              {t('resendInvite')}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={() => openEdit(user)}
          >
            {t('editUser')}
          </Button>
        </div>
      </Panel>
    );
  }

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-end gap-3">
        <Button
          type="button"
          disabled={pending}
          onClick={() => {
            setError(null);
            setCreateOpen(true);
          }}
        >
          {t('createUser')}
        </Button>
      </div>

      <Modal
        open={createOpen}
        onClose={closeCreateModal}
        title={t('createUser')}
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
              disabled={pending || !createReady}
              onClick={() => void createUser()}
            >
              {sendInvite ? t('sendInvite') : t('create')}
            </Button>
          </>
        }
      >
        <Field label={t('email')}>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            data-modal-initial-focus
          />
        </Field>
        <Field label={t('displayName')}>
          <Input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
          />
        </Field>
        <Field label={t('fullName')}>
          <Input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder={t('fullNameOptional')}
          />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={sendInvite}
            onChange={(e) => {
              setSendInvite(e.target.checked);
              if (e.target.checked) setPassword('');
            }}
          />
          {t('sendInviteEmail')}
        </label>
        {!sendInvite ? (
          <div className="grid gap-2">
            <Field label={t('password')}>
              <PasswordInput
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                placeholder={t('passwordHint')}
                autoComplete="new-password"
              />
            </Field>
            <PasswordStrengthHint value={password} />
          </div>
        ) : (
          <p className="m-0 text-sm text-ink-muted">{t('inviteHint')}</p>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={isSystemAdmin}
            onChange={(e) => setIsSystemAdmin(e.target.checked)}
          />
          {t('systemAdmin')}
        </label>
        {error ? <ErrorText>{error}</ErrorText> : null}
      </Modal>

      <Modal
        open={editUser != null}
        onClose={closeEdit}
        title={t('editUser')}
        description={editUser?.email}
        footer={
          <>
            <Button type="button" variant="secondary" disabled={pending} onClick={closeEdit}>
              {tCommon('cancel')}
            </Button>
            <Button
              type="button"
              disabled={pending || !editDisplayName.trim()}
              onClick={() => void saveEdit()}
            >
              {tCommon('save')}
            </Button>
          </>
        }
      >
        {editUser ? (
          <div className="grid gap-3">
            <Field label={t('displayName')}>
              <Input
                value={editDisplayName}
                onChange={(e) => setEditDisplayName(e.target.value)}
                data-modal-initial-focus
              />
            </Field>
            <Field label={t('fullName')}>
              <Input
                value={editFullName}
                onChange={(e) => setEditFullName(e.target.value)}
                placeholder={t('fullNameOptional')}
              />
            </Field>
            <Field label={tCommon('status')}>
              <Select value={editStatus} onChange={(e) => setEditStatus(e.target.value)}>
                <option value="active">{t('statusActive')}</option>
                <option value="disabled">{t('statusDisabled')}</option>
                <option value="invited">{t('statusInvited')}</option>
                <option value="pending_email">{t('statusPendingEmail')}</option>
                <option value="pending_approval">{t('statusPendingApproval')}</option>
              </Select>
            </Field>
            <div className="grid gap-2">
              <Field label={t('newPasswordOptional')}>
                <PasswordInput
                  value={editPassword}
                  onChange={(e) => setEditPassword(e.target.value)}
                  minLength={8}
                  placeholder={t('passwordHint')}
                  autoComplete="new-password"
                />
              </Field>
              <PasswordStrengthHint value={editPassword} />
            </div>
            <Field label={t('idpSource')}>
              <Input
                value={editIdpSource}
                onChange={(e) => setEditIdpSource(e.target.value)}
                placeholder={t('idpStubHint')}
                autoComplete="off"
              />
            </Field>
            <Field label={t('idpSubject')}>
              <Input
                value={editIdpSubject}
                onChange={(e) => setEditIdpSubject(e.target.value)}
                placeholder={t('idpStubHint')}
                autoComplete="off"
              />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={editIsSystemAdmin}
                onChange={(e) => setEditIsSystemAdmin(e.target.checked)}
              />
              {t('systemAdmin')}
            </label>
            {editUser.status === 'invited' ? (
              <Button
                type="button"
                variant="secondary"
                disabled={pending}
                onClick={() => void resendInvite(editUser.id)}
              >
                {t('resendInvite')}
              </Button>
            ) : null}
            {editError ? <ErrorText>{editError}</ErrorText> : null}
          </div>
        ) : null}
      </Modal>

      <Modal
        open={approveUser != null}
        onClose={closeApprove}
        title={t('approveUser')}
        description={approveUser?.email}
        size="lg"
        footer={
          <>
            <Button type="button" variant="secondary" disabled={pending} onClick={closeApprove}>
              {tCommon('cancel')}
            </Button>
            <Button
              type="button"
              disabled={pending || !approveReady}
              onClick={() => void approvePendingUser()}
            >
              {t('approveConfirm')}
            </Button>
          </>
        }
      >
        {approveUser ? (
          <div className="grid gap-3">
            <p className="m-0 text-sm text-ink-muted">{t('approveHint')}</p>
            {workspaces.length === 0 ? (
              <ErrorText>{t('approveNoWorkspaces')}</ErrorText>
            ) : (
              approveRows.map((row, index) => (
                <div
                  key={`approve-row-${index}`}
                  className="grid gap-2 sm:grid-cols-[1fr_10rem_auto] sm:items-end"
                >
                  <Field label={t('approveWorkspace')}>
                    <Select
                      value={row.workspaceId}
                      onChange={(e) => {
                        const next = [...approveRows];
                        next[index] = { ...row, workspaceId: e.target.value };
                        setApproveRows(next);
                      }}
                      data-modal-initial-focus={index === 0 ? true : undefined}
                    >
                      <option value="">{t('approveSelectWorkspace')}</option>
                      {workspaces.map((workspace) => (
                        <option key={workspace.id} value={workspace.id}>
                          {workspace.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label={t('approveRole')}>
                    <Select
                      value={row.role}
                      onChange={(e) => {
                        const next = [...approveRows];
                        next[index] = {
                          ...row,
                          role: e.target.value as ApproveMembershipRow['role'],
                        };
                        setApproveRows(next);
                      }}
                    >
                      {ROLES.map((role) => (
                        <option key={role} value={role}>
                          {role === 'workspace_admin'
                            ? t('roleWorkspaceAdmin')
                            : role === 'maintainer'
                              ? t('roleMaintainer')
                              : t('roleReader')}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={approveRows.length <= 1}
                    onClick={() =>
                      setApproveRows(approveRows.filter((_, i) => i !== index))
                    }
                  >
                    {t('approveRemoveRow')}
                  </Button>
                </div>
              ))
            )}
            <Button
              type="button"
              variant="secondary"
              disabled={workspaces.length === 0}
              onClick={() =>
                setApproveRows([
                  ...approveRows,
                  { workspaceId: workspaces[0]?.id ?? '', role: 'reader' },
                ])
              }
            >
              {t('approveAddMembership')}
            </Button>
            {approveError ? <ErrorText>{approveError}</ErrorText> : null}
          </div>
        ) : null}
      </Modal>

      {pendingApproval.length > 0 ? (
        <section className="grid gap-3">
          <h2 className="m-0 text-base font-semibold">{t('pendingApprovalTitle')}</h2>
          <p className="m-0 text-sm text-ink-muted">{t('pendingApprovalHint')}</p>
          {pendingApproval.map((user) => renderUserRow(user, { showApprove: true }))}
        </section>
      ) : null}

      {pendingEmail.length > 0 ? (
        <section className="grid gap-3">
          <h2 className="m-0 text-base font-semibold">{t('pendingEmailTitle')}</h2>
          <p className="m-0 text-sm text-ink-muted">{t('pendingEmailHint')}</p>
          {pendingEmail.map((user) => renderUserRow(user))}
        </section>
      ) : null}

      <section className="grid gap-3">
        {pendingApproval.length > 0 || pendingEmail.length > 0 ? (
          <h2 className="m-0 text-base font-semibold">{t('allUsersTitle')}</h2>
        ) : null}
        {otherUsers.length === 0 &&
        pendingApproval.length === 0 &&
        pendingEmail.length === 0 ? (
          <p className="kh-muted">{t('emptyUsers')}</p>
        ) : otherUsers.length === 0 ? (
          <p className="kh-muted">{t('emptyOtherUsers')}</p>
        ) : (
          otherUsers.map((user) => renderUserRow(user))
        )}
      </section>
    </div>
  );
}
