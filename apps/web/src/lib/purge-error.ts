export type PurgeBlocker = {
  count: number;
  itemKey: string | null;
  itemTitle: string | null;
  workspaceName: string;
};

export type PurgeErrorBody = {
  error?: {
    code?: string;
    message?: string;
    details?: { blockers?: PurgeBlocker[] } | null;
  };
};

type Translate = (key: string, values?: Record<string, string | number>) => string;

export function purgeFailureLines(body: PurgeErrorBody, t: Translate): string[] {
  const blockers = body.error?.details?.blockers;
  if (body.error?.code === 'WORKSPACE_PURGE_BLOCKED' && blockers && blockers.length > 0) {
    return blockers.map((blocker) =>
      t('purgeBlockedMedia', {
        count: blocker.count,
        item: blocker.itemKey || blocker.itemTitle || t('purgeBlockedUnknownItem'),
        workspace: blocker.workspaceName,
      }),
    );
  }
  if (body.error?.code === 'STILL_REFERENCED') {
    return [t('cannotDeleteReferenced')];
  }
  if (body.error?.code === 'INVALID_REFERENCE') {
    return [t('referencedRecordMissing')];
  }
  return [body.error?.message || t('failedDelete')];
}
