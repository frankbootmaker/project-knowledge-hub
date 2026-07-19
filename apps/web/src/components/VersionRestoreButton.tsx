'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button, ErrorText } from './ui';

export function VersionRestoreButton({
  recordId,
  versionNumber,
  workspaceSlug,
  recordSlug,
}: {
  recordId: string;
  versionNumber: number;
  workspaceSlug: string;
  recordSlug: string;
}) {
  const router = useRouter();
  const t = useTranslations('records');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onRestore() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/v1/knowledge-records/${recordId}/versions/${versionNumber}/restore`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            changeMessage: t('restoredFromVersion', { version: versionNumber }),
          }),
        },
      );
      const payload = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? t('failedRestore'));
      }
      router.push(`/workspaces/${workspaceSlug}/records/${recordSlug}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('failedRestore'));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-1">
      <Button
        type="button"
        variant="secondary"
        disabled={pending}
        onClick={() => void onRestore()}
      >
        {pending ? t('restoring') : t('restore')}
      </Button>
      {error ? <ErrorText>{error}</ErrorText> : null}
    </div>
  );
}
