'use client';

import type { FormEvent } from 'react';
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { evaluatePasswordStrength } from '@project-knowledge-hub/domain';
import { LanguageSwitcher } from '../../components/LanguageSwitcher';
import { Button, ErrorText, Field, Page, Panel, PasswordInput, PasswordStrengthHint } from '../../components/ui';

function SetPasswordForm() {
  const t = useTranslations('setPassword');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [emailHint, setEmailHint] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [checking, setChecking] = useState(Boolean(token));

  useEffect(() => {
    if (!token) {
      setPreviewError(t('missingToken'));
      setChecking(false);
      return;
    }

    let cancelled = false;
    async function check() {
      setChecking(true);
      try {
        const response = await fetch(
          `/api/v1/auth/set-password/preview?token=${encodeURIComponent(token)}`,
          { credentials: 'include' },
        );
        const payload = (await response.json()) as {
          status?: string;
          email?: string | null;
          error?: { message?: string };
        };
        if (cancelled) return;
        if (!response.ok) {
          setPreviewError(payload.error?.message ?? t('invalidLink'));
          return;
        }
        if (payload.status === 'valid') {
          setEmailHint(payload.email ?? null);
          setPreviewError(null);
        } else if (payload.status === 'expired') {
          setPreviewError(t('expiredLink'));
        } else if (payload.status === 'used') {
          setPreviewError(t('usedLink'));
        } else {
          setPreviewError(t('invalidLink'));
        }
      } catch {
        if (!cancelled) setPreviewError(t('invalidLink'));
      } finally {
        if (!cancelled) setChecking(false);
      }
    }
    void check();
    return () => {
      cancelled = true;
    };
  }, [token, t]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError(t('mismatch'));
      return;
    }
    if (!evaluatePasswordStrength(password).acceptable) {
      setError(tCommon('passwordPolicy'));
      return;
    }

    setPending(true);
    try {
      const response = await fetch('/api/v1/auth/set-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: window.location.origin,
        },
        credentials: 'include',
        body: JSON.stringify({ token, password }),
      });
      const payload = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? t('failed'));
      }
      router.replace('/login?passwordSet=1');
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
          {tCommon('appName')}
        </p>
        <h1 className="m-0 text-3xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="mt-2 text-ink-muted">{t('subtitle')}</p>
        {emailHint ? (
          <p className="mt-1 mb-0 text-sm text-ink-muted">{t('forEmail', { email: emailHint })}</p>
        ) : null}
      </div>
      <Panel>
        {checking ? (
          <p className="m-0 text-ink-muted">{tCommon('loading')}</p>
        ) : previewError ? (
          <div className="grid gap-4">
            <ErrorText>{previewError}</ErrorText>
            <Link href="/forgot-password" className="text-sm text-brand underline-offset-2 hover:underline">
              {t('requestNew')}
            </Link>
            <Link href="/login" className="text-sm text-ink-muted underline-offset-2 hover:underline">
              {t('backToLogin')}
            </Link>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="grid gap-4">
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
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
              />
            </Field>
            {error ? <ErrorText>{error}</ErrorText> : null}
            <Button type="submit" disabled={pending} className="mt-1 w-full py-2.5">
              {pending ? t('saving') : t('submit')}
            </Button>
          </form>
        )}
      </Panel>
    </Page>
  );
}

export default function SetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <SetPasswordForm />
    </Suspense>
  );
}
