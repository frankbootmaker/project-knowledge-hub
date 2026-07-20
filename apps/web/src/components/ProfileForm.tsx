'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { UserAvatar } from './UserAvatar';
import Link from 'next/link';
import { Button, ErrorText, Field, Input, LinkButton, Panel, useToast } from './ui';

export type ProfileUser = {
  id: string;
  email: string;
  displayName: string;
  fullName: string | null;
  idpSource: string | null;
  idpSubject: string | null;
  avatarUrl: string | null;
};

const CLOSE_PHRASE = 'CLOSE';

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

  const [closeStep, setCloseStep] = useState<0 | 1 | 2>(0);
  const [closePhrase, setClosePhrase] = useState('');
  const [closeAcknowledged, setCloseAcknowledged] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);

  const isLocalAccount = !initialUser.idpSource && !initialUser.idpSubject;

  function applyUser(user: ProfileUser) {
    setDisplayName(user.displayName);
    setFullName(user.fullName ?? '');
    setAvatarUrl(user.avatarUrl);
  }

  function resetCloseFlow() {
    setCloseStep(0);
    setClosePhrase('');
    setCloseAcknowledged(false);
    setCloseError(null);
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

  async function onCloseAccount() {
    if (closePhrase.trim() !== CLOSE_PHRASE || !closeAcknowledged) return;
    setPending(true);
    setCloseError(null);
    try {
      const response = await fetch('/api/v1/me', {
        method: 'DELETE',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Origin: window.location.origin,
        },
        body: JSON.stringify({ confirmPhrase: CLOSE_PHRASE }),
      });
      const payload = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? t('closeFailed'));
      }
      pushToast(t('closeDone'));
      router.replace('/login?accountClosed=1');
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : t('closeFailed');
      setCloseError(message);
      pushToast(message, 'danger');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-6">
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

      <Panel className="grid gap-3">
        <h2 className="m-0 text-base font-semibold">{t('connectAiTitle')}</h2>
        <p className="m-0 text-sm text-ink-muted">{t('connectAiBlurb')}</p>
        <div>
          <LinkButton href="/account/ai-connections">{t('connectAiLink')}</LinkButton>
        </div>
        <p className="m-0 text-xs text-ink-muted">
          <Link href="/ai-discover" className="underline-offset-2 hover:underline">
            {t('connectAiDiscover')}
          </Link>
        </p>
      </Panel>

      <Panel className="grid gap-2">
        <h2 className="m-0 text-base font-semibold">{t('identityTitle')}</h2>
        {isLocalAccount ? (
          <p className="m-0 text-sm text-ink-muted">{t('localAccount')}</p>
        ) : (
          <div className="grid gap-1 text-sm">
            <p className="m-0">
              <span className="text-ink-muted">{t('idpSource')}: </span>
              {initialUser.idpSource}
            </p>
            <p className="m-0">
              <span className="text-ink-muted">{t('idpSubject')}: </span>
              <code className="text-xs">{initialUser.idpSubject}</code>
            </p>
          </div>
        )}
      </Panel>

      <Panel className="grid gap-3">
        <h2 className="m-0 text-base font-semibold">{t('closeTitle')}</h2>
        <p className="m-0 text-sm text-ink-muted">{t('closeBlurb')}</p>

        {closeStep === 0 ? (
          <div>
            <Button
              type="button"
              variant="danger"
              disabled={pending}
              onClick={() => {
                setCloseStep(1);
                setClosePhrase('');
                setCloseAcknowledged(false);
                setCloseError(null);
              }}
            >
              {t('closeStart')}
            </Button>
          </div>
        ) : null}

        {closeStep === 1 ? (
          <Panel variant="inset" className="grid gap-3">
            <p className="m-0 text-sm text-danger">{t('closeWarning1')}</p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="danger"
                disabled={pending}
                onClick={() => {
                  setCloseStep(2);
                  setClosePhrase('');
                  setCloseAcknowledged(false);
                }}
              >
                {t('closeContinue')}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={pending}
                onClick={resetCloseFlow}
              >
                {tCommon('cancel')}
              </Button>
            </div>
          </Panel>
        ) : null}

        {closeStep === 2 ? (
          <Panel variant="inset" className="grid gap-3">
            <p className="m-0 text-sm text-danger">{t('closeWarning2')}</p>
            <Field label={t('closePhraseLabel', { phrase: CLOSE_PHRASE })}>
              <Input
                value={closePhrase}
                onChange={(e) => setClosePhrase(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                disabled={pending}
              />
            </Field>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={closeAcknowledged}
                disabled={pending}
                onChange={(e) => setCloseAcknowledged(e.target.checked)}
              />
              <span>{t('closeAcknowledge')}</span>
            </label>
            {closeError ? <ErrorText>{closeError}</ErrorText> : null}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="danger"
                disabled={
                  pending ||
                  closePhrase.trim() !== CLOSE_PHRASE ||
                  !closeAcknowledged
                }
                onClick={() => void onCloseAccount()}
              >
                {t('closeConfirmFinal')}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={pending}
                onClick={() => {
                  setCloseStep(1);
                  setClosePhrase('');
                  setCloseAcknowledged(false);
                }}
              >
                {t('closeBack')}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={pending}
                onClick={resetCloseFlow}
              >
                {tCommon('cancel')}
              </Button>
            </div>
          </Panel>
        ) : null}
      </Panel>
    </div>
  );
}
