'use client';

import type { FormEvent } from 'react';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import {
  Button,
  ErrorText,
  Field,
  Input,
  PasswordInput,
} from '../ui';
import type { AppLocale } from '../../i18n/config';
import type { AuthMode } from './auth-mode';
import { AuthNavLink } from './AuthNavLink';

function safeNextPath(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) {
    return '/dashboard';
  }
  return raw;
}

export function LoginForm({
  onNavigate,
}: {
  onNavigate?: (mode: AuthMode) => void;
}) {
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
  const nextPath = safeNextPath(searchParams.get('next'));

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

      router.replace(nextPath);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('failed'));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="kh-lp-login-form">
      {passwordSet ? (
        <p className="kh-lp-login-banner kh-lp-login-banner--ok">{t('passwordSet')}</p>
      ) : null}
      {accountClosed ? (
        <p className="kh-lp-login-banner">{t('accountClosed')}</p>
      ) : null}
      {ssoEnabled ? (
        <div className="kh-lp-login-actions">
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
          <p className="kh-lp-login-or">{t('ssoOrPassword')}</p>
        </div>
      ) : null}
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
        <Field label={t('password')}>
          <PasswordInput
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            autoComplete="current-password"
          />
        </Field>
        {error ? <ErrorText>{error}</ErrorText> : null}
        <div className="kh-lp-login-actions">
          <Button type="submit" disabled={pending} className="w-full py-2.5">
            {pending ? t('signingIn') : t('signIn')}
          </Button>
        </div>
        <div className="kh-lp-login-links">
          <AuthNavLink mode="register" onNavigate={onNavigate}>
            {t('register')}
          </AuthNavLink>
          <AuthNavLink mode="forgot-password" onNavigate={onNavigate}>
            {t('forgotPassword')}
          </AuthNavLink>
        </div>
        <p className="kh-lp-login-discover">
          <Link href="/ai-discover">{t('aiDiscover')}</Link>
        </p>
      </form>
    </div>
  );
}
