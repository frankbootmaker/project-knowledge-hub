'use client';

import type { FormEvent } from 'react';
import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { AuthCard } from '../../components/ops/AuthCard';
import { Button, ErrorText, Field, Input } from '../../components/ui';
import { getThemePreference } from '../../lib/theme-actions';
import type { AppTheme } from '../../lib/theme';

function ForgotPasswordForm({ theme }: { theme: AppTheme }) {
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

  return (
    <AuthCard
      brand={t('accessBrand')}
      eyebrow={t('eyebrow')}
      title={t('title')}
      subtitle={t('subtitle')}
      theme={theme}
    >
      {done ? (
        <div className="mt-4 grid gap-4">
          <p className="m-0 text-ink">{t('success')}</p>
          <div className="kh-ops-auth-links">
            <Link href="/login">{t('backToLogin')}</Link>
          </div>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="mt-4 grid gap-4">
          <Field label={t('email')}>
            <Input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              autoComplete="username"
            />
          </Field>
          {error ? <ErrorText>{error}</ErrorText> : null}
          <div className="kh-ops-auth-actions">
            <Button type="submit" disabled={pending} className="w-full py-2.5">
              {pending ? t('sending') : t('submit')}
            </Button>
          </div>
          <div className="kh-ops-auth-links">
            <Link href="/login">{t('backToLogin')}</Link>
          </div>
        </form>
      )}
    </AuthCard>
  );
}

export default async function ForgotPasswordPage() {
  const theme = await getThemePreference();
  return <ForgotPasswordForm theme={theme} />;
}
