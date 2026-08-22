'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { AuthCard } from '../../components/ops/AuthCard';
import { Button, ErrorText } from '../../components/ui';

function ConfirmEmailForm() {
  const t = useTranslations('confirmEmail');
  const tCommon = useTranslations('common');
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [checking, setChecking] = useState(Boolean(token));
  const [confirming, setConfirming] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [emailHint, setEmailHint] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
          `/api/v1/auth/confirm-email/preview?token=${encodeURIComponent(token)}`,
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

  async function onConfirm() {
    setConfirming(true);
    setError(null);
    try {
      const response = await fetch('/api/v1/auth/confirm-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: window.location.origin,
        },
        credentials: 'include',
        body: JSON.stringify({ token }),
      });
      const payload = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? t('failed'));
      }
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('failed'));
    } finally {
      setConfirming(false);
    }
  }

  return (
    <AuthCard
      brand={t('accessBrand')}
      eyebrow={t('eyebrow')}
      title={t('title')}
      subtitle={t('subtitle')}
    >
      {checking ? (
        <p className="mt-4 mb-0 text-ink-muted">{tCommon('loading')}</p>
      ) : previewError ? (
        <div className="mt-4 grid gap-4">
          <ErrorText>{previewError}</ErrorText>
          <div className="kh-ops-auth-links">
            <Link href="/register">{t('backToRegister')}</Link>
            <Link href="/login">{t('backToLogin')}</Link>
          </div>
        </div>
      ) : done ? (
        <div className="mt-4 grid gap-4">
          <p className="m-0 text-ink">{t('success')}</p>
          <p className="m-0 text-sm text-ink-muted">{t('successHint')}</p>
          <div className="kh-ops-auth-links">
            <Link href="/login">{t('backToLogin')}</Link>
          </div>
        </div>
      ) : (
        <div className="mt-4 grid gap-4">
          {emailHint ? (
            <p className="m-0 text-sm text-ink-muted">
              {t('forEmail', { email: emailHint })}
            </p>
          ) : null}
          {error ? <ErrorText>{error}</ErrorText> : null}
          <div className="kh-ops-auth-actions">
            <Button
              type="button"
              disabled={confirming}
              className="w-full py-2.5"
              onClick={() => void onConfirm()}
            >
              {confirming ? t('confirming') : t('confirm')}
            </Button>
          </div>
        </div>
      )}
    </AuthCard>
  );
}

export default function ConfirmEmailPage() {
  return (
    <Suspense fallback={null}>
      <ConfirmEmailForm />
    </Suspense>
  );
}
