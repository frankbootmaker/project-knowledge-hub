'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { purgeFailureLines, type PurgeErrorBody } from '../lib/purge-error';
import { Button, ErrorText } from './ui';

export type PurgeEntityKind = 'workspace' | 'project' | 'system' | 'record' | 'import';

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
  const [errorLines, setErrorLines] = useState<string[]>([]);

  async function purgeEntity() {
    if (!acknowledged) {
      return;
    }
    setPending(true);
    setErrorLines([]);
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
        const payload = (await response.json().catch(() => ({}))) as PurgeErrorBody;
        setErrorLines(
          purgeFailureLines(payload, (key, values) => t(key as 'failedDelete', values)),
        );
        return;
      }
      router.push(redirectOnPurge);
      router.refresh();
    } catch {
      setErrorLines([t('failedDelete')]);
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
          setErrorLines([]);
        }}
      >
        {t('deletePermanently')}
      </Button>
    );
  }

  return (
    <div className="kh-ops-confirm">
      <p className="m-0 text-sm text-danger">{t('confirmDelete', { name: entityName })}</p>
      <p className="m-0 text-xs text-ink-muted">{t(hintKeyByKind[kind])}</p>
      {extraHint ? <p className="m-0 text-xs text-ink-muted">{extraHint}</p> : null}
      <label className="flex items-start gap-2 text-sm text-ink">
        <input
          type="checkbox"
          checked={acknowledged}
          disabled={pending}
          onChange={(event) => setAcknowledged(event.target.checked)}
        />
        <span>{t('deleteAcknowledge')}</span>
      </label>
      {errorLines.length === 1 ? <ErrorText>{errorLines[0]}</ErrorText> : null}
      {errorLines.length > 1 ? (
        <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-sm text-danger">
          {errorLines.map((line, index) => (
            <li key={`${index}-${line}`}>{line}</li>
          ))}
        </ul>
      ) : null}
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
            setErrorLines([]);
          }}
        >
          {tCommon('cancel')}
        </Button>
      </div>
    </div>
  );
}
