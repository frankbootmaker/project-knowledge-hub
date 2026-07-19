'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button, ErrorText, Panel } from './ui';

export type ArchiveEntityKind = 'workspace' | 'project' | 'system' | 'record';

const pathByKind: Record<ArchiveEntityKind, string> = {
  workspace: 'workspaces',
  project: 'projects',
  system: 'systems',
  record: 'knowledge-records',
};

export function ArchiveEntityButton({
  kind,
  entityId,
  entityName,
  archived,
  disabled,
  redirectOnArchive,
}: {
  kind: ArchiveEntityKind;
  entityId: string;
  entityName: string;
  archived: boolean;
  disabled?: boolean;
  /** Where to navigate after a successful archive (e.g. parent list). */
  redirectOnArchive?: string;
}) {
  const t = useTranslations('archive');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function archiveEntity() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/${pathByKind[kind]}/${entityId}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { Origin: window.location.origin },
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: { message?: string } };
        throw new Error(payload.error?.message ?? t('failedArchive'));
      }
      setConfirming(false);
      if (redirectOnArchive) {
        router.push(redirectOnArchive);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('failedArchive'));
    } finally {
      setPending(false);
    }
  }

  async function restoreEntity() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/${pathByKind[kind]}/${entityId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Origin: window.location.origin,
        },
        body: JSON.stringify({ archived: false }),
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: { message?: string } };
        throw new Error(payload.error?.message ?? t('failedRestore'));
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('failedRestore'));
    } finally {
      setPending(false);
    }
  }

  if (archived) {
    return (
      <div className="grid gap-2">
        <Button
          type="button"
          variant="secondary"
          disabled={disabled || pending}
          onClick={() => void restoreEntity()}
        >
          {pending ? t('restoring') : t('restore')}
        </Button>
        {error ? <ErrorText>{error}</ErrorText> : null}
      </div>
    );
  }

  if (!confirming) {
    return (
      <Button
        type="button"
        variant="danger"
        disabled={disabled || pending}
        onClick={() => setConfirming(true)}
      >
        {t('archive')}
      </Button>
    );
  }

  return (
    <Panel variant="inset" className="grid w-full max-w-md gap-3">
      <p className="m-0 text-sm text-danger">
        {t('confirmArchive', { name: entityName })}
      </p>
      <p className="m-0 text-xs text-ink-muted">{t('archiveHint')}</p>
      {error ? <ErrorText>{error}</ErrorText> : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="danger"
          disabled={pending}
          onClick={() => void archiveEntity()}
        >
          {pending ? t('archiving') : t('confirmArchiveAction')}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={pending}
          onClick={() => {
            setConfirming(false);
            setError(null);
          }}
        >
          {tCommon('cancel')}
        </Button>
      </div>
    </Panel>
  );
}
