'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { UserAvatar } from './UserAvatar';
import { Button, ErrorText, Field, Input, Panel, useToast } from './ui';

export type ProfileUser = {
  id: string;
  email: string;
  displayName: string;
  fullName: string | null;
  avatarUrl: string | null;
};

export function ProfileForm({ initialUser }: { initialUser: ProfileUser }) {
  const t = useTranslations('profile');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const { pushToast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [displayName, setDisplayName] = useState(initialUser.displayName);
  const [fullName, setFullName] = useState(initialUser.fullName ?? '');
  const [avatarUrl, setAvatarUrl] = useState(initialUser.avatarUrl);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function applyUser(user: ProfileUser) {
    setDisplayName(user.displayName);
    setFullName(user.fullName ?? '');
    setAvatarUrl(user.avatarUrl);
  }

  async function onSave() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/v1/me', {
        method: 'PATCH',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Origin: window.location.origin,
        },
        body: JSON.stringify({
          displayName: displayName.trim(),
          fullName: fullName.trim() || null,
        }),
      });
      const payload = (await response.json()) as {
        error?: { message?: string };
        user?: ProfileUser;
      };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? t('failed'));
      }
      if (payload.user) applyUser(payload.user);
      pushToast(t('saved'));
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : t('failed');
      setError(message);
      pushToast(message, 'danger');
    } finally {
      setPending(false);
    }
  }

  async function onAvatarSelected(file: File | null) {
    if (!file) return;
    setPending(true);
    setError(null);
    try {
      const body = new FormData();
      body.append('file', file);
      const response = await fetch('/api/v1/me/avatar', {
        method: 'POST',
        credentials: 'include',
        headers: { Origin: window.location.origin },
        body,
      });
      const payload = (await response.json()) as {
        error?: { message?: string };
        user?: ProfileUser;
      };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? t('avatarFailed'));
      }
      if (payload.user) applyUser(payload.user);
      pushToast(t('avatarSaved'));
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : t('avatarFailed');
      setError(message);
      pushToast(message, 'danger');
    } finally {
      setPending(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function onRemoveAvatar() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/v1/me/avatar', {
        method: 'DELETE',
        credentials: 'include',
        headers: { Origin: window.location.origin },
      });
      const payload = (await response.json()) as {
        error?: { message?: string };
        user?: ProfileUser;
      };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? t('avatarFailed'));
      }
      if (payload.user) applyUser(payload.user);
      pushToast(t('avatarRemoved'));
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : t('avatarFailed');
      setError(message);
      pushToast(message, 'danger');
    } finally {
      setPending(false);
    }
  }

  return (
    <Panel className="grid gap-4">
      <div className="flex flex-wrap items-center gap-4">
        <UserAvatar
          displayName={displayName}
          fullName={fullName}
          avatarUrl={avatarUrl}
          size="lg"
        />
        <div className="grid gap-2">
          <p className="m-0 text-sm text-ink-muted">{t('avatarHint')}</p>
          <div className="flex flex-wrap gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              onChange={(e) => void onAvatarSelected(e.target.files?.[0] ?? null)}
            />
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() => fileRef.current?.click()}
            >
              {t('avatarUpload')}
            </Button>
            {avatarUrl ? (
              <Button
                type="button"
                variant="secondary"
                disabled={pending}
                onClick={() => void onRemoveAvatar()}
              >
                {t('avatarRemove')}
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      <Field label={t('email')}>
        <Input value={initialUser.email} readOnly disabled />
      </Field>
      <p className="m-0 text-sm text-ink-muted">{t('emailHint')}</p>
      <Field label={t('displayName')}>
        <Input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          required
          maxLength={160}
        />
      </Field>
      <Field label={t('fullName')}>
        <Input
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          maxLength={200}
          placeholder={t('fullNamePlaceholder')}
        />
      </Field>
      {error ? <ErrorText>{error}</ErrorText> : null}
      <div>
        <Button
          type="button"
          disabled={pending || !displayName.trim()}
          onClick={() => void onSave()}
        >
          {pending ? tCommon('saving') : tCommon('save')}
        </Button>
      </div>
    </Panel>
  );
}
