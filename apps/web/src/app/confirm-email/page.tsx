'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { LanguageSwitcher } from '../../components/LanguageSwitcher';
import { Button, ErrorText, Page, Panel } from '../../components/ui';

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
        {checking ? (
          <p className="m-0 text-ink-muted">{tCommon('loading')}</p>
        ) : previewError ? (
          <div className="grid gap-4">
            <ErrorText>{previewError}</ErrorText>
            <Link href="/register" className="text-sm text-brand underline-offset-2 hover:underline">
              {t('backToRegister')}
            </Link>
            <Link href="/login" className="text-sm text-ink-muted underline-offset-2 hover:underline">
              {t('backToLogin')}
            </Link>
          </div>
        ) : done ? (
          <div className="grid gap-4">
            <p className="m-0 text-ink">{t('success')}</p>
            <p className="m-0 text-sm text-ink-muted">{t('successHint')}</p>
            <Link href="/login" className="text-sm text-brand underline-offset-2 hover:underline">
              {t('backToLogin')}
            </Link>
          </div>
        ) : (
          <div className="grid gap-4">
            {emailHint ? (
              <p className="m-0 text-sm text-ink-muted">
                {t('forEmail', { email: emailHint })}
              </p>
            ) : null}
            {error ? <ErrorText>{error}</ErrorText> : null}
            <Button
              type="button"
              disabled={confirming}
              className="w-full py-2.5"
              onClick={() => void onConfirm()}
            >
              {confirming ? t('confirming') : t('confirm')}
            </Button>
          </div>
        )}
      </Panel>
    </Page>
  );
}

export default function ConfirmEmailPage() {
  return (
    <Suspense fallback={null}>
      <ConfirmEmailForm />
    </Suspense>
  );
}
