'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Badge, Button, ErrorText, Field, Input, Panel, Select, useToast } from '../ui';

export type PublicUser = {
  id: string;
  email: string;
  displayName: string;
  status: string;
  isSystemAdmin: boolean;
  createdAt: string;
};

export function UsersAdmin({ initialUsers }: { initialUsers: PublicUser[] }) {
  const t = useTranslations('admin');
  const router = useRouter();
  const { pushToast } = useToast();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [isSystemAdmin, setIsSystemAdmin] = useState(false);

  async function createUser() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/v1/users', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, displayName, password, isSystemAdmin }),
      });
      const payload = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? t('failed'));
      }
      const createdName = displayName;
      setEmail('');
      setDisplayName('');
      setPassword('');
      setIsSystemAdmin(false);
      pushToast(t('toastUserCreated', { name: createdName }));
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : t('failed');
      setError(message);
      pushToast(message, 'danger');
    } finally {
      setPending(false);
    }
  }

  async function updateUser(
    userId: string,
    patch: Partial<{ status: string; isSystemAdmin: boolean; displayName: string }>,
  ) {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/users/${userId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const payload = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? t('failed'));
      }
      pushToast(t('toastUserUpdated'));
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : t('failed');
      setError(message);
      pushToast(message, 'danger');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-6">
      <Panel>
        <h2 className="mt-0 mb-4 text-lg font-semibold">{t('createUser')}</h2>
        <div className="grid gap-4">
          <Field label={t('email')}>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </Field>
          <Field label={t('displayName')}>
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
            />
          </Field>
          <Field label={t('password')}>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={12}
              placeholder={t('passwordHint')}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isSystemAdmin}
              onChange={(e) => setIsSystemAdmin(e.target.checked)}
            />
            {t('systemAdmin')}
          </label>
          {error ? <ErrorText>{error}</ErrorText> : null}
          <Button
            type="button"
            disabled={pending || !email || !displayName || password.length < 12}
            onClick={() => void createUser()}
          >
            {t('create')}
          </Button>
        </div>
      </Panel>

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
                </div>
                <p className="mt-1 mb-0 text-sm text-ink-muted">{user.email}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  className="w-auto"
                  value={user.status}
                  disabled={pending}
                  onChange={(e) => void updateUser(user.id, { status: e.target.value })}
                >
                  <option value="active">{t('statusActive')}</option>
                  <option value="disabled">{t('statusDisabled')}</option>
                  <option value="invited">{t('statusInvited')}</option>
                </Select>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={pending}
                  onClick={() =>
                    void updateUser(user.id, { isSystemAdmin: !user.isSystemAdmin })
                  }
                >
                  {user.isSystemAdmin ? t('removeSystemAdmin') : t('makeSystemAdmin')}
                </Button>
              </div>
            </Panel>
          ))
        )}
      </div>
    </div>
  );
}
