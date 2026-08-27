'use client';

import type { FormEvent } from 'react';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, ErrorText, Field, Input } from '../ui';
import type { AuthMode } from './auth-mode';
import { AuthNavLink } from './AuthNavLink';

export function ForgotPasswordForm({
  onNavigate,
}: {
  onNavigate?: (mode: AuthMode) => void;
}) {
  const t = useTranslations('forgotPassword');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      const response = await fetch('/api/v1/auth/forgot-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: window.location.origin,
        },
        credentials: 'include',
        body: JSON.stringify({ email }),
      });

      const contentType = response.headers.get('content-type') ?? '';
      const payload = contentType.includes('application/json')
        ? ((await response.json()) as { error?: { message?: string } })
        : null;

      if (!response.ok) {
        throw new Error(payload?.error?.message ?? t('failed'));
      }

      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('failed'));
    } finally {
      setPending(false);
    }
  }

  if (done) {
    return (
      <div className="kh-lp-login-form">
        <p className="kh-lp-login-banner kh-lp-login-banner--ok">{t('success')}</p>
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
          autoComplete="username"
          data-modal-initial-focus
        />
      </Field>
      {error ? <ErrorText>{error}</ErrorText> : null}
      <div className="kh-lp-login-actions">
        <Button type="submit" disabled={pending} className="w-full py-2.5">
          {pending ? t('sending') : t('submit')}
        </Button>
      </div>
      <div className="kh-lp-login-links">
        <AuthNavLink mode="login" onNavigate={onNavigate}>
          {t('backToLogin')}
        </AuthNavLink>
      </div>
    </form>
  );
}
