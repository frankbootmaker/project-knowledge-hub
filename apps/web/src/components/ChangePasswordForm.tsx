'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { evaluatePasswordStrength } from '@project-knowledge-hub/domain';
import {
  Button,
  ErrorText,
  Field,
  Panel,
  PasswordInput,
  PasswordStrengthHint,
  useToast,
} from './ui';

export function ChangePasswordForm({ hasPassword }: { hasPassword: boolean }) {
  const t = useTranslations('account');
  const tCommon = useTranslations('common');
  const { pushToast } = useToast();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (!hasPassword) {
    return (
      <Panel>
        <p className="m-0 text-sm text-ink-muted">{t('passwordUnavailable')}</p>
      </Panel>
    );
  }

  async function onSubmit() {
    setError(null);
    if (newPassword !== confirmPassword) {
      setError(t('passwordMismatch'));
      return;
    }
    if (!evaluatePasswordStrength(newPassword).acceptable) {
      setError(tCommon('passwordPolicy'));
      return;
    }
    if (currentPassword === newPassword) {
      setError(t('passwordSameAsCurrent'));
      return;
    }

    setPending(true);
    try {
      const response = await fetch('/api/v1/me/password', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Origin: window.location.origin,
        },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const payload = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? t('passwordFailed'));
      }
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      pushToast(t('passwordSaved'));
    } catch (err) {
      const message = err instanceof Error ? err.message : t('passwordFailed');
      setError(message);
      pushToast(message, 'danger');
    } finally {
      setPending(false);
    }
  }

  return (
    <Panel className="grid gap-4">
      <p className="m-0 text-sm text-ink-muted">{t('passwordBlurb')}</p>
      <Field label={t('currentPassword')}>
        <PasswordInput
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          required
          autoComplete="current-password"
        />
      </Field>
      <Field label={t('newPassword')}>
        <PasswordInput
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          required
          minLength={8}
          autoComplete="new-password"
        />
      </Field>
      <PasswordStrengthHint value={newPassword} />
      <Field label={t('confirmPassword')}>
        <PasswordInput
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
          minLength={8}
          autoComplete="new-password"
        />
      </Field>
      {error ? <ErrorText>{error}</ErrorText> : null}
      <div>
        <Button
          type="button"
          disabled={
            pending ||
            !currentPassword ||
            !newPassword ||
            !confirmPassword
          }
          onClick={() => void onSubmit()}
        >
          {pending ? t('passwordSaving') : t('passwordSubmit')}
        </Button>
      </div>
    </Panel>
  );
}
