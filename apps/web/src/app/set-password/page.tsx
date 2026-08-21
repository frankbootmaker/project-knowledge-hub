'use client';

import type { FormEvent } from 'react';
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { evaluatePasswordStrength } from '@project-knowledge-hub/domain';
import { AuthCard } from '../../components/ops/AuthCard';
import { Button, ErrorText, Field, PasswordInput, PasswordStrengthHint } from '../../components/ui';

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
    <AuthCard
      brand={t('accessBrand')}
      eyebrow={t('eyebrow')}
      title={t('title')}
      subtitle={
        <>
          {t('subtitle')}
          {emailHint ? ` ${t('forEmail', { email: emailHint })}` : null}
        </>
      }
    >
      {checking ? (
        <p className="mt-4 mb-0 text-ink-muted">{tCommon('loading')}</p>
      ) : previewError ? (
        <div className="mt-4 grid gap-4">
          <ErrorText>{previewError}</ErrorText>
          <div className="kh-ops-auth-links">
            <Link href="/forgot-password">{t('requestNew')}</Link>
            <Link href="/login">{t('backToLogin')}</Link>
          </div>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="mt-4 grid gap-4">
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
          <div className="kh-ops-auth-actions">
            <Button type="submit" disabled={pending} className="w-full py-2.5">
              {pending ? t('saving') : t('submit')}
            </Button>
          </div>
        </form>
      )}
    </AuthCard>
  );
}

export default function SetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <SetPasswordForm />
    </Suspense>
  );
}
