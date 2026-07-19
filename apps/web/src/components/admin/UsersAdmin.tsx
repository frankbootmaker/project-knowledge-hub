'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  Badge,
  Button,
  ErrorText,
  Field,
  Input,
  Modal,
  Panel,
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

export function UsersAdmin({ initialUsers }: { initialUsers: PublicUser[] }) {
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
      const createdName = displayName;
      closeCreateModal();
      pushToast(t('toastUserCreated', { name: createdName }));
      if (payload.mail?.warning) {
        pushToast(payload.mail.warning, 'info');
      }
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

  const createReady =
    email.trim().length > 0 &&
    displayName.trim().length > 0 &&
    (sendInvite || password.length >= 12);

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
          <Field label={t('password')}>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={12}
              placeholder={t('passwordHint')}
              autoComplete="new-password"
            />
          </Field>
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
              </Select>
            </Field>
            <Field label={t('newPasswordOptional')}>
              <Input
                type="password"
                value={editPassword}
                onChange={(e) => setEditPassword(e.target.value)}
                minLength={12}
                placeholder={t('passwordHint')}
                autoComplete="new-password"
              />
            </Field>
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

      <div className="grid gap-3">
        {initialUsers.length === 0 ? (
          <p className="kh-muted">{t('emptyUsers')}</p>
        ) : (
          initialUsers.map((user) => (
            <Panel key={user.id} className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <strong>{user.displayName}</strong>
                  <Badge tone={user.status === 'active' ? 'success' : 'warn'}>
                    {user.status}
                  </Badge>
                  {user.isSystemAdmin ? <Badge tone="brand">{t('systemAdmin')}</Badge> : null}
                  {user.idpSource ? (
                    <Badge tone="neutral">{user.idpSource}</Badge>
                  ) : null}
                </div>
                <p className="mt-1 mb-0 text-sm text-ink-muted">{user.email}</p>
                {user.fullName ? (
                  <p className="mt-0.5 mb-0 text-sm text-ink-muted">{user.fullName}</p>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
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
          ))
        )}
      </div>
    </div>
  );
}
