'use client';

import type { FormEvent } from 'react';
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { AuthCard } from '../../components/ops/AuthCard';
import {
  Button,
  ErrorText,
  Field,
  Input,
  PasswordInput,
} from '../../components/ui';
import type { AppLocale } from '../../i18n/config';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const locale = useLocale() as AppLocale;
  const t = useTranslations('login');
  const [email, setEmail] = useState('admin@localhost.local');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [ssoEnabled, setSsoEnabled] = useState(false);
  const [ssoLabel, setSsoLabel] = useState('Sign in with SSO');
  const passwordSet = searchParams.get('passwordSet') === '1';
  const accountClosed = searchParams.get('accountClosed') === '1';
  const ssoError = searchParams.get('sso');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch('/api/v1/auth/oidc/status', {
          credentials: 'include',
        });
        if (!response.ok) return;
        const payload = (await response.json()) as {
          enabled?: boolean;
          buttonLabel?: string;
        };
        if (cancelled) return;
        setSsoEnabled(Boolean(payload.enabled));
        if (typeof payload.buttonLabel === 'string' && payload.buttonLabel.trim()) {
          setSsoLabel(payload.buttonLabel);
        }
      } catch {
        // SSO optional — ignore status failures
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ssoError) return;
    const key =
      ssoError === 'unknown'
        ? 'ssoUnknown'
        : ssoError === 'inactive'
          ? 'ssoInactive'
          : ssoError === 'conflict'
            ? 'ssoConflict'
            : 'ssoError';
    setError(t(key));
  }, [ssoError, t]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      const response = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password, preferredLocale: locale }),
      });

      const contentType = response.headers.get('content-type') ?? '';
      const payload = contentType.includes('application/json')
        ? ((await response.json()) as { error?: { message?: string } })
        : null;

      if (!response.ok) {
        throw new Error(payload?.error?.message ?? `${t('failed')} (${response.status})`);
      }

      router.replace('/dashboard');
      router.refresh();
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
      title={t('welcomeTitle')}
      subtitle={t('subtitle')}
    >
      {passwordSet ? (
        <p className="mt-4 mb-0 text-sm text-brand">{t('passwordSet')}</p>
      ) : null}
      {accountClosed ? (
        <p className="mt-4 mb-0 text-sm text-ink-muted">{t('accountClosed')}</p>
      ) : null}
      {ssoEnabled ? (
        <div className="kh-ops-auth-actions">
          <Button
            type="button"
            variant="secondary"
            className="w-full py-2.5"
            onClick={() => {
              window.location.href = '/api/v1/auth/oidc/start';
            }}
          >
            {ssoLabel}
          </Button>
          <p className="m-0 text-center text-xs text-ink-muted">{t('ssoOrPassword')}</p>
        </div>
      ) : null}
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
        <Field label={t('password')}>
          <PasswordInput
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            autoComplete="current-password"
          />
        </Field>
        {error ? <ErrorText>{error}</ErrorText> : null}
        <div className="kh-ops-auth-actions">
          <Button type="submit" disabled={pending} className="w-full py-2.5">
            {pending ? t('signingIn') : t('signIn')}
          </Button>
        </div>
        <div className="kh-ops-auth-links">
          <Link href="/register">{t('register')}</Link>
          <Link href="/forgot-password">{t('forgotPassword')}</Link>
        </div>
        <p className="m-0 text-center text-xs text-ink-muted">
          <Link href="/ai-discover" className="underline-offset-2 hover:underline">
            {t('aiDiscover')}
          </Link>
        </p>
      </form>
    </AuthCard>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
