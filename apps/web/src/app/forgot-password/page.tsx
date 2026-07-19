'use client';

import type { FormEvent } from 'react';
import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { LanguageSwitcher } from '../../components/LanguageSwitcher';
import { Button, ErrorText, Field, Input, Page, Panel } from '../../components/ui';

export default function ForgotPasswordPage() {
  const t = useTranslations('forgotPassword');
  const tCommon = useTranslations('common');
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
    <Page narrow className="px-4 py-16">
      <div className="mb-4 flex justify-end">
        <LanguageSwitcher />
      </div>
      <div className="mb-6">
        <p className="mb-1 text-xs font-semibold tracking-[0.14em] text-ink-muted uppercase">
          {tCommon('appName')}
        </p>
        <h1 className="m-0 text-3xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="mt-2 text-ink-muted">{t('subtitle')}</p>
      </div>
      <Panel>
        {done ? (
          <div className="grid gap-4">
            <p className="m-0 text-ink">{t('success')}</p>
            <Link href="/login" className="text-sm text-brand underline-offset-2 hover:underline">
              {t('backToLogin')}
            </Link>
          </div>
        ) : (
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
            {error ? <ErrorText>{error}</ErrorText> : null}
            <Button type="submit" disabled={pending} className="mt-1 w-full py-2.5">
              {pending ? t('sending') : t('submit')}
            </Button>
            <Link href="/login" className="text-sm text-ink-muted underline-offset-2 hover:underline">
              {t('backToLogin')}
            </Link>
          </form>
        )}
      </Panel>
    </Page>
  );
}
