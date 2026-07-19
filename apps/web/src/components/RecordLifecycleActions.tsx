'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button, ErrorText } from './ui';

export function RecordLifecycleActions({
  recordId,
  lifecycleStatus,
}: {
  recordId: string;
  lifecycleStatus: string;
}) {
  const router = useRouter();
  const t = useTranslations('records');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  async function run(action: 'verify' | 'mark-current') {
    setPending(action);
    setError(null);
    try {
      const response = await fetch(`/api/v1/knowledge-records/${recordId}/${action}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const payload = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? t('failedAction', { action }));
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('failedAction', { action }));
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {lifecycleStatus !== 'verified' && lifecycleStatus !== 'current' ? (
        <Button
          type="button"
          variant="success"
          disabled={pending !== null}
          onClick={() => void run('verify')}
        >
          {pending === 'verify' ? t('verifying') : t('verify')}
        </Button>
      ) : null}
      {lifecycleStatus !== 'current' ? (
        <Button
          type="button"
          disabled={pending !== null}
          onClick={() => void run('mark-current')}
        >
          {pending === 'mark-current' ? t('updating') : t('markCurrentAction')}
        </Button>
      ) : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
    </div>
  );
}
