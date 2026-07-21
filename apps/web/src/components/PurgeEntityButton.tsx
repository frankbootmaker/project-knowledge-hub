'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button, ErrorText, Panel } from './ui';

export type PurgeEntityKind =
  | 'workspace'
  | 'project'
  | 'system'
  | 'record'
  | 'import';

const pathByKind: Record<PurgeEntityKind, string> = {
  workspace: 'workspaces',
  project: 'projects',
  system: 'systems',
  record: 'knowledge-records',
  import: 'conversation-imports',
};

const hintKeyByKind: Record<
  PurgeEntityKind,
  | 'deleteHintWorkspace'
  | 'deleteHintProject'
  | 'deleteHintSystem'
  | 'deleteHintRecord'
  | 'deleteHintImport'
> = {
  workspace: 'deleteHintWorkspace',
  project: 'deleteHintProject',
  system: 'deleteHintSystem',
  record: 'deleteHintRecord',
  import: 'deleteHintImport',
};

export function PurgeEntityButton({
  kind,
  entityId,
  entityName,
  disabled,
  redirectOnPurge,
  extraHint,
}: {
  kind: PurgeEntityKind;
  entityId: string;
  entityName: string;
  disabled?: boolean;
  redirectOnPurge: string;
  /** Optional extra warning (e.g. git_managed may reappear). */
  extraHint?: string | null;
}) {
  const t = useTranslations('archive');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function purgeEntity() {
    if (!acknowledged) {
      return;
    }
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/${pathByKind[kind]}/${entityId}/purge`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Origin: window.location.origin,
        },
        body: JSON.stringify({ confirmDestroy: true }),
      });
      if (!response.ok && response.status !== 204) {
        const payload = (await response.json()) as { error?: { message?: string } };
        throw new Error(payload.error?.message ?? t('failedDelete'));
      }
      router.push(redirectOnPurge);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('failedDelete'));
    } finally {
      setPending(false);
    }
  }

  if (!confirming) {
    return (
      <Button
        type="button"
        variant="danger"
        disabled={disabled || pending}
        onClick={() => {
          setConfirming(true);
          setAcknowledged(false);
          setError(null);
        }}
      >
        {t('deletePermanently')}
      </Button>
    );
  }

  return (
    <Panel variant="inset" className="grid w-full max-w-md gap-3">
      <p className="m-0 text-sm text-danger">
        {t('confirmDelete', { name: entityName })}
      </p>
      <p className="m-0 text-xs text-ink-muted">{t(hintKeyByKind[kind])}</p>
      {extraHint ? (
        <p className="m-0 text-xs text-ink-muted">{extraHint}</p>
      ) : null}
      <label className="flex items-start gap-2 text-sm text-ink">
        <input
          type="checkbox"
          checked={acknowledged}
          disabled={pending}
          onChange={(event) => setAcknowledged(event.target.checked)}
        />
        <span>{t('deleteAcknowledge')}</span>
      </label>
      {error ? <ErrorText>{error}</ErrorText> : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="danger"
          disabled={pending || !acknowledged}
          onClick={() => void purgeEntity()}
        >
          {pending ? t('deletingPermanently') : t('confirmDeleteAction')}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={pending}
          onClick={() => {
            setConfirming(false);
            setAcknowledged(false);
            setError(null);
          }}
        >
          {tCommon('cancel')}
        </Button>
      </div>
    </Panel>
  );
}
