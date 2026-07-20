'use client';

import type { FormEvent } from 'react';
import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { LanguageSwitcher } from '../../components/LanguageSwitcher';
import { Button, ErrorText, Field, Input, Page, Panel, PasswordInput } from '../../components/ui';
import type { AppLocale } from '../../i18n/config';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const locale = useLocale() as AppLocale;
  const t = useTranslations('login');
  const tCommon = useTranslations('common');
  const [email, setEmail] = useState('admin@localhost.local');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const passwordSet = searchParams.get('passwordSet') === '1';
  const accountClosed = searchParams.get('accountClosed') === '1';

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
    <Page narrow className="px-4 py-16">
      <div className="mb-4 flex justify-end">
        <LanguageSwitcher />
      </div>
      <div className="mb-6">
        <p className="mb-1 text-xs font-semibold tracking-[0.14em] text-ink-muted uppercase">
          {tCommon('brandName')}
        </p>
        <h1 className="m-0 text-3xl font-semibold tracking-tight">{tCommon('appName')}</h1>
        <p className="mt-2 text-ink-muted">{t('subtitle')}</p>
      </div>
      <Panel>
        {passwordSet ? (
          <p className="mt-0 mb-4 text-sm text-brand">{t('passwordSet')}</p>
        ) : null}
        {accountClosed ? (
          <p className="mt-0 mb-4 text-sm text-ink-muted">{t('accountClosed')}</p>
        ) : null}
        <form onSubmit={onSubmit} className="grid gap-4">
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
          <Button type="submit" disabled={pending} className="mt-1 w-full py-2.5">
            {pending ? t('signingIn') : t('signIn')}
          </Button>
          <div className="flex items-center justify-between gap-4">
            <Link
              href="/register"
              className="text-sm text-ink-muted underline-offset-2 hover:underline"
            >
              {t('register')}
            </Link>
            <Link
              href="/forgot-password"
              className="text-sm text-ink-muted underline-offset-2 hover:underline"
            >
              {t('forgotPassword')}
            </Link>
          </div>
          <p className="m-0 text-center text-sm text-ink-muted">
            <Link
              href="/ai-discover"
              className="underline-offset-2 hover:underline"
            >
              {t('aiDiscover')}
            </Link>
          </p>
        </form>
      </Panel>
    </Page>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
