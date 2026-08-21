'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { evaluatePasswordStrength } from '@project-knowledge-hub/domain';
import {
  Button,
  ErrorText,
  Field,
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
      <section className="kh-ops-panel">
        <div className="kh-ops-card-body">
          <p className="m-0 text-sm text-ink-muted">{t('passwordUnavailable')}</p>
        </div>
      </section>
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
    <section className="kh-ops-panel kh-ops-narrow-form">
      <div className="kh-ops-panel-head">
        <h2 className="kh-ops-panel-title">{t('password')}</h2>
      </div>
      <div className="kh-ops-card-body">
        <p className="mt-0 mb-3 text-sm text-ink-muted">{t('passwordBlurb')}</p>
        <div className="kh-ops-form-grid">
          <Field className="kh-ops-field-span" label={t('currentPassword')}>
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
          <Field label={t('confirmPassword')}>
            <PasswordInput
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
            />
          </Field>
          <div className="kh-ops-field-span">
            <PasswordStrengthHint value={newPassword} />
          </div>
          {error ? (
            <div className="kh-ops-field-span">
              <ErrorText>{error}</ErrorText>
            </div>
          ) : null}
        </div>
      </div>
      <div className="kh-ops-action-line">
        <span className="kh-ops-panel-meta">{t('password')}</span>
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
    </section>
  );
}
