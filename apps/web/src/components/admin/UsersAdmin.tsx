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
  FunctionHeader,
  Input,
  Modal,
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
type StatusFilter =
  | 'all'
  | 'active'
  | 'disabled'
  | 'invited'
  | 'pending_email'
  | 'pending_approval';

const DEFAULT_PAGE_SIZE = 5;
const PAGE_SIZE_OPTIONS = [5, 10, 25, 50] as const;
type PageSizeOption = (typeof PAGE_SIZE_OPTIONS)[number];

function isPageSizeOption(value: number): value is PageSizeOption {
  return (PAGE_SIZE_OPTIONS as readonly number[]).includes(value);
}

function statusTone(status: string): 'success' | 'warn' | 'danger' | 'neutral' | 'brand' {
  if (status === 'active') return 'success';
  if (status === 'disabled') return 'danger';
  if (status === 'pending_approval') return 'brand';
  if (status === 'pending_email') return 'warn';
  return 'warn';
}

function isClosedAccount(user: PublicUser): boolean {
  return user.email.endsWith('@closed.local');
}

function matchesSearch(user: PublicUser, query: string): boolean {
  if (!query) return true;
  const haystack = [
    user.displayName,
    user.email,
    user.fullName ?? '',
    user.idpSource ?? '',
    user.idpSubject ?? '',
  ]
    .join(' ')
    .toLowerCase();
  return haystack.includes(query);
}

export function UsersAdmin({
  initialUsers,
  workspaces,
  currentUserId,
  allowHardDelete = false,
}: {
  initialUsers: PublicUser[];
  workspaces: WorkspaceOption[];
  currentUserId: string;
  /** Development/test only — permanent purge of user + authored knowledge. */
  allowHardDelete?: boolean;
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

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSizeOption>(DEFAULT_PAGE_SIZE);

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

  const [removeStep, setRemoveStep] = useState<0 | 1 | 2>(0);
  const [removeAcknowledged, setRemoveAcknowledged] = useState(false);
  const [removeHardDelete, setRemoveHardDelete] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const filteredUsers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return initialUsers.filter((user) => {
      if (statusFilter !== 'all' && user.status !== statusFilter) return false;
      return matchesSearch(user, query);
    });
  }, [initialUsers, searchQuery, statusFilter]);

  const pendingApproval = useMemo(
    () => filteredUsers.filter((user) => user.status === 'pending_approval'),
    [filteredUsers],
  );
  const pendingEmail = useMemo(
    () => filteredUsers.filter((user) => user.status === 'pending_email'),
    [filteredUsers],
  );
  const otherUsers = useMemo(
    () =>
      filteredUsers.filter(
        (user) =>
          user.status !== 'pending_approval' && user.status !== 'pending_email',
      ),
    [filteredUsers],
  );

  const totalPages = Math.max(1, Math.ceil(otherUsers.length / pageSize) || 1);
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const pageStart = (currentPage - 1) * pageSize;
  const pageUsers = otherUsers.slice(pageStart, pageStart + pageSize);
  const rangeFrom = otherUsers.length === 0 ? 0 : pageStart + 1;
  const rangeTo = Math.min(pageStart + pageSize, otherUsers.length);

  function updateSearchQuery(value: string) {
    setSearchQuery(value);
    setPage(1);
  }

  function updateStatusFilter(value: StatusFilter) {
    setStatusFilter(value);
    setPage(1);
  }

  function updatePageSize(raw: string) {
    const parsed = Number(raw);
    setPageSize(isPageSizeOption(parsed) ? parsed : DEFAULT_PAGE_SIZE);
    setPage(1);
  }

  function statusLabel(status: string): string {
    if (status === 'pending_email') return t('statusPendingEmail');
    if (status === 'pending_approval') return t('statusPendingApproval');
    if (status === 'active') return t('statusActive');
    if (status === 'disabled') return t('statusDisabled');
    if (status === 'invited') return t('statusInvited');
    return status;
  }

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

  function resetRemoveFlow() {
    setRemoveStep(0);
    setRemoveAcknowledged(false);
    setRemoveHardDelete(false);
    setRemoveError(null);
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
    resetRemoveFlow();
  }

  function closeEdit() {
    setEditUser(null);
    setEditPassword('');
    setEditError(null);
    resetRemoveFlow();
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

  async function confirmRemoveUser() {
    if (!editUser || !removeAcknowledged) return;
    const hard = allowHardDelete && (removeHardDelete || isClosedAccount(editUser));
    setPending(true);
    setRemoveError(null);
    try {
      const url = hard
        ? `/api/v1/users/${editUser.id}?hard=1`
        : `/api/v1/users/${editUser.id}`;
      const response = await fetch(url, {
        method: 'DELETE',
        credentials: 'include',
        headers: { Origin: window.location.origin },
      });
      const payload = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? t('removeUserFailed'));
      }
      pushToast(
        hard
          ? t('toastUserPurged', { name: editUser.displayName })
          : t('toastUserRemoved', { name: editUser.displayName }),
      );
      closeEdit();
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : t('removeUserFailed');
      setRemoveError(message);
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

  function canEdit(user: PublicUser): boolean {
    if (user.id === currentUserId) return false;
    if (isClosedAccount(user)) return allowHardDelete;
    return true;
  }

  function canRemove(user: PublicUser): boolean {
    if (user.id === currentUserId) return false;
    if (isClosedAccount(user)) return allowHardDelete;
    return true;
  }

  function renderUserRow(user: PublicUser, options?: { showApprove?: boolean }) {
    return (
      <tr key={user.id}>
        <td className="kh-ops-primary-cell">
          {user.displayName}
          {user.fullName ? (
            <div className="text-[11px] font-normal text-ink-muted">
              {user.fullName}
            </div>
          ) : null}
        </td>
        <td>{user.email}</td>
        <td>
          <div className="flex flex-wrap items-center gap-1">
            <Badge tone={statusTone(user.status)}>{statusLabel(user.status)}</Badge>
            {user.isSystemAdmin ? <Badge tone="brand">{t('systemAdmin')}</Badge> : null}
            {user.idpSource ? <Badge tone="neutral">{user.idpSource}</Badge> : null}
            {isClosedAccount(user) ? (
              <Badge tone="danger">{t('statusClosed')}</Badge>
            ) : null}
          </div>
        </td>
        <td>
          <div className="flex flex-wrap items-center gap-2">
            {options?.showApprove ? (
              <>
                <Button
                  type="button"
                  className="h-8 min-h-8 px-2 text-xs"
                  disabled={pending || workspaces.length === 0}
                  onClick={() => openApprove(user)}
                >
                  {t('approveUser')}
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  className="h-8 min-h-8 px-2 text-xs"
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
                className="h-8 min-h-8 px-2 text-xs"
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
                className="h-8 min-h-8 px-2 text-xs"
                disabled={pending}
                onClick={() => void resendInvite(user.id)}
              >
                {t('resendInvite')}
              </Button>
            ) : null}
            {!isClosedAccount(user) || allowHardDelete ? (
              <Button
                type="button"
                variant="secondary"
                className="h-8 min-h-8 px-2 text-xs"
                disabled={pending || !canEdit(user)}
                onClick={() => openEdit(user)}
              >
                {t('editUser')}
              </Button>
            ) : null}
          </div>
        </td>
      </tr>
    );
  }

  return (
    <div className="grid gap-6">
      <FunctionHeader
        search={
          <Input
            type="search"
            value={searchQuery}
            onChange={(e) => updateSearchQuery(e.target.value)}
            placeholder={t('usersSearchPlaceholder')}
            aria-label={t('usersSearchPlaceholder')}
          />
        }
        filters={
          <>
            <Select
              value={statusFilter}
              onChange={(e) =>
                updateStatusFilter(e.target.value as StatusFilter)
              }
              aria-label={t('usersFilterStatus')}
            >
              <option value="all">{t('usersFilterAll')}</option>
              <option value="active">{t('statusActive')}</option>
              <option value="disabled">{t('statusDisabled')}</option>
              <option value="invited">{t('statusInvited')}</option>
              <option value="pending_email">{t('statusPendingEmail')}</option>
              <option value="pending_approval">{t('statusPendingApproval')}</option>
            </Select>
            <Select
              value={String(pageSize)}
              onChange={(e) => updatePageSize(e.target.value)}
              aria-label={t('pageSize')}
            >
              {PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={String(size)}>
                  {t('pageSizeOption', { count: size })}
                </option>
              ))}
            </Select>
          </>
        }
        actions={
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
        }
      />

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
          editUser && isClosedAccount(editUser) && allowHardDelete ? (
            <Button type="button" variant="secondary" disabled={pending} onClick={closeEdit}>
              {tCommon('cancel')}
            </Button>
          ) : (
            <>
              <Button type="button" variant="secondary" disabled={pending} onClick={closeEdit}>
                {tCommon('cancel')}
              </Button>
              <Button
                type="button"
                disabled={pending || removeStep > 0 || !editDisplayName.trim()}
                onClick={() => void saveEdit()}
              >
                {tCommon('save')}
              </Button>
            </>
          )
        }
      >
        {editUser ? (
          <div className="grid gap-3">
            {!(isClosedAccount(editUser) && allowHardDelete) ? (
              <>
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
              </>
            ) : (
              <p className="m-0 text-sm text-ink-muted">{t('purgeClosedHint')}</p>
            )}

            {canRemove(editUser) ? (
              <div className="kh-ops-danger-copy grid gap-3">
                {removeStep === 0 ? (
                  <Button
                    type="button"
                    variant="danger"
                    disabled={pending}
                    onClick={() => {
                      setRemoveStep(1);
                      setRemoveAcknowledged(false);
                      setRemoveHardDelete(isClosedAccount(editUser));
                      setRemoveError(null);
                    }}
                  >
                    {isClosedAccount(editUser)
                      ? t('purgeUser')
                      : t('removeUser')}
                  </Button>
                ) : null}

                {removeStep === 1 ? (
                  <div className="kh-ops-confirm">
                    <p className="m-0 text-sm text-danger">
                      {allowHardDelete &&
                      (removeHardDelete || isClosedAccount(editUser))
                        ? t('purgeUserWarning1', { name: editUser.displayName })
                        : t('removeUserWarning1', { name: editUser.displayName })}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="danger"
                        disabled={pending}
                        onClick={() => {
                          setRemoveStep(2);
                          setRemoveAcknowledged(false);
                        }}
                      >
                        {t('removeUserContinue')}
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={pending}
                        onClick={resetRemoveFlow}
                      >
                        {tCommon('cancel')}
                      </Button>
                    </div>
                  </div>
                ) : null}

                {removeStep === 2 ? (
                  <div className="kh-ops-confirm">
                    <p className="m-0 text-sm text-danger">
                      {allowHardDelete &&
                      (removeHardDelete || isClosedAccount(editUser))
                        ? t('purgeUserWarning2', { name: editUser.displayName })
                        : t('removeUserWarning2', { name: editUser.displayName })}
                    </p>
                    {allowHardDelete && !isClosedAccount(editUser) ? (
                      <label className="flex items-start gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={removeHardDelete}
                          disabled={pending}
                          onChange={(e) => setRemoveHardDelete(e.target.checked)}
                        />
                        <span>{t('purgeUserOption')}</span>
                      </label>
                    ) : null}
                    <label className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={removeAcknowledged}
                        disabled={pending}
                        onChange={(e) => setRemoveAcknowledged(e.target.checked)}
                      />
                      <span>
                        {allowHardDelete &&
                        (removeHardDelete || isClosedAccount(editUser))
                          ? t('purgeUserAcknowledge')
                          : t('removeUserAcknowledge')}
                      </span>
                    </label>
                    {removeError ? <ErrorText>{removeError}</ErrorText> : null}
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="danger"
                        disabled={pending || !removeAcknowledged}
                        onClick={() => void confirmRemoveUser()}
                      >
                        {allowHardDelete &&
                        (removeHardDelete || isClosedAccount(editUser))
                          ? t('purgeUserConfirmFinal')
                          : t('removeUserConfirmFinal')}
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={pending}
                        onClick={() => {
                          setRemoveStep(1);
                          setRemoveAcknowledged(false);
                        }}
                      >
                        {t('removeUserBack')}
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={pending}
                        onClick={resetRemoveFlow}
                      >
                        {tCommon('cancel')}
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
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
        <section className="kh-ops-panel">
          <div className="kh-ops-panel-head">
            <h2 className="kh-ops-panel-title">{t('pendingApprovalTitle')}</h2>
          </div>
          <p className="m-0 px-3 pt-3 text-[11px] text-ink-muted">
            {t('pendingApprovalHint')}
          </p>
          <div className="kh-ops-table-wrap">
            <table className="kh-ops-data-table">
              <thead>
                <tr>
                  <th>{t('colName')}</th>
                  <th>{t('colEmail')}</th>
                  <th>{t('colStatus')}</th>
                  <th>{t('colActions')}</th>
                </tr>
              </thead>
              <tbody>
                {pendingApproval.map((user) =>
                  renderUserRow(user, { showApprove: true }),
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {pendingEmail.length > 0 ? (
        <section className="kh-ops-panel">
          <div className="kh-ops-panel-head">
            <h2 className="kh-ops-panel-title">{t('pendingEmailTitle')}</h2>
          </div>
          <p className="m-0 px-3 pt-3 text-[11px] text-ink-muted">
            {t('pendingEmailHint')}
          </p>
          <div className="kh-ops-table-wrap">
            <table className="kh-ops-data-table">
              <thead>
                <tr>
                  <th>{t('colName')}</th>
                  <th>{t('colEmail')}</th>
                  <th>{t('colStatus')}</th>
                  <th>{t('colActions')}</th>
                </tr>
              </thead>
              <tbody>{pendingEmail.map((user) => renderUserRow(user))}</tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="kh-ops-panel">
        {pendingApproval.length > 0 || pendingEmail.length > 0 ? (
          <div className="kh-ops-panel-head">
            <h2 className="kh-ops-panel-title">{t('allUsersTitle')}</h2>
          </div>
        ) : null}
        {filteredUsers.length === 0 ? (
          <p className="kh-ops-empty">
            {initialUsers.length === 0 ? t('emptyUsers') : t('emptyUsersFiltered')}
          </p>
        ) : otherUsers.length === 0 ? (
          <p className="kh-ops-empty">{t('emptyOtherUsers')}</p>
        ) : (
          <>
            <div className="kh-ops-table-wrap">
              <table className="kh-ops-data-table">
                <thead>
                  <tr>
                    <th>{t('colName')}</th>
                    <th>{t('colEmail')}</th>
                    <th>{t('colStatus')}</th>
                    <th>{t('colActions')}</th>
                  </tr>
                </thead>
                <tbody>{pageUsers.map((user) => renderUserRow(user))}</tbody>
              </table>
            </div>
            <div className="kh-ops-card-foot">
              <p className="m-0 text-xs text-ink-muted">
                {t('showing', {
                  from: rangeFrom,
                  to: rangeTo,
                  total: otherUsers.length,
                })}
              </p>
              {totalPages > 1 ? (
                <nav
                  className="flex flex-wrap items-center gap-2"
                  aria-label={t('allUsersTitle')}
                >
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={currentPage <= 1}
                    onClick={() => setPage(Math.max(1, currentPage - 1))}
                  >
                    {t('prevPage')}
                  </Button>
                  <span className="kh-page-num-active" aria-current="page">
                    {currentPage} / {totalPages}
                  </span>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={currentPage >= totalPages}
                    onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
                  >
                    {t('nextPage')}
                  </Button>
                </nav>
              ) : null}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
