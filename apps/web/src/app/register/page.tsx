'use client';

import type { FormEvent } from 'react';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { evaluatePasswordStrength } from '@project-knowledge-hub/domain';
import { LanguageSwitcher } from '../../components/LanguageSwitcher';
import {
  Button,
  ErrorText,
  Field,
  Input,
  Page,
  Panel,
  PasswordInput,
  PasswordStrengthHint,
} from '../../components/ui';

export default function RegisterPage() {
  const router = useRouter();
  const t = useTranslations('register');
  const tCommon = useTranslations('common');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

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
        }),
      });

      const contentType = response.headers.get('content-type') ?? '';
      const payload = contentType.includes('application/json')
        ? ((await response.json()) as { error?: { message?: string } })
        : null;

      if (!response.ok) {
        throw new Error(payload?.error?.message ?? t('failed'));
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
        <h1 className="m-0 text-3xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="mt-2 text-ink-muted">{t('subtitle')}</p>
      </div>
      <Panel>
        <form onSubmit={onSubmit} className="grid gap-4">
          <Field label={t('email')}>
            <Input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              autoComplete="email"
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
          <Button type="submit" disabled={pending} className="mt-1 w-full py-2.5">
            {pending ? t('submitting') : t('submit')}
          </Button>
          <p className="m-0 text-sm text-ink-muted">
            {t('haveAccount')}{' '}
            <Link href="/login" className="text-brand underline-offset-2 hover:underline">
              {t('backToLogin')}
            </Link>
          </p>
        </form>
      </Panel>
    </Page>
  );
}
