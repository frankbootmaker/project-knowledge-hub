'use client';

import type { FormEvent } from 'react';
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { evaluatePasswordStrength } from '@project-knowledge-hub/domain';
import {
  Button,
  ErrorText,
  Field,
  Input,
  PasswordInput,
  PasswordStrengthHint,
} from '../ui';
import type { AppLocale } from '../../i18n/config';
import type { AuthMode } from './auth-mode';
import { AuthNavLink } from './AuthNavLink';

export function RegisterForm({
  onNavigate,
}: {
  onNavigate?: (mode: AuthMode) => void;
}) {
  const locale = useLocale() as AppLocale;
  const t = useTranslations('register');
  const tCommon = useTranslations('common');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [resendPending, setResendPending] = useState(false);
  const [resendMessage, setResendMessage] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError(t('mismatch'));
      return;
    }
    if (!evaluatePasswordStrength(password).acceptable) {
      setError(tCommon('passwordPolicy'));
      return;
    }

    setPending(true);
    try {
      const response = await fetch('/api/v1/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: window.location.origin,
        },
        credentials: 'include',
        body: JSON.stringify({
          email,
          displayName,
          password,
          preferredLocale: locale,
        }),
      });

      const contentType = response.headers.get('content-type') ?? '';
      const payload = contentType.includes('application/json')
        ? ((await response.json()) as {
            error?: { message?: string };
            message?: string;
          })
        : null;

      if (!response.ok) {
        throw new Error(payload?.error?.message ?? t('failed'));
      }

      setDone(true);
      setResendMessage(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('failed'));
    } finally {
      setPending(false);
    }
  }

  async function onResend() {
    setResendPending(true);
    setResendMessage(null);
    setError(null);
    try {
      const response = await fetch('/api/v1/auth/resend-confirmation', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: window.location.origin,
        },
        credentials: 'include',
        body: JSON.stringify({ email }),
      });
      const payload = (await response.json()) as {
        error?: { message?: string };
        message?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? t('resendFailed'));
      }
      setResendMessage(payload.message ?? t('resendSuccess'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('resendFailed'));
    } finally {
      setResendPending(false);
    }
  }

  if (done) {
    return (
      <div className="kh-lp-login-form">
        <p className="kh-lp-login-banner kh-lp-login-banner--ok">{t('checkEmail')}</p>
        <p className="kh-lp-login-or">{t('checkEmailHint')}</p>
        {resendMessage ? (
          <p className="kh-lp-login-banner kh-lp-login-banner--ok">{resendMessage}</p>
        ) : null}
        {error ? <ErrorText>{error}</ErrorText> : null}
        <div className="kh-lp-login-actions">
          <Button
            type="button"
            variant="secondary"
            disabled={resendPending}
            onClick={() => void onResend()}
          >
            {resendPending ? t('resending') : t('resendConfirmation')}
          </Button>
        </div>
        <div className="kh-lp-login-links">
          <AuthNavLink mode="login" onNavigate={onNavigate}>
            {t('backToLogin')}
          </AuthNavLink>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="kh-lp-login-fields">
      <Field label={t('email')}>
        <Input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
          autoComplete="email"
          data-modal-initial-focus
        />
      </Field>
      <Field label={t('displayName')}>
        <Input
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          required
          maxLength={160}
          autoComplete="nickname"
        />
      </Field>
      <Field label={t('password')}>
        <PasswordInput
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
          minLength={8}
          autoComplete="new-password"
        />
      </Field>
      <PasswordStrengthHint value={password} />
      <Field label={t('confirmPassword')}>
        <PasswordInput
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          required
          minLength={8}
          autoComplete="new-password"
        />
      </Field>
      {error ? <ErrorText>{error}</ErrorText> : null}
      <div className="kh-lp-login-actions">
        <Button type="submit" disabled={pending} className="w-full py-2.5">
          {pending ? t('submitting') : t('submit')}
        </Button>
      </div>
      <div className="kh-lp-login-links">
        <span>{t('haveAccount')}</span>
        <AuthNavLink mode="login" onNavigate={onNavigate}>
          {t('backToLogin')}
        </AuthNavLink>
      </div>
    </form>
  );
}
