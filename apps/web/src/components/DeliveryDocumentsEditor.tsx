'use client';

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { LinkedKnowledgeRecord } from './LinkedKnowledgeRecord';
import {
  RecordLinkPickerList,
  type RecordLinkPickerQuery,
} from './RecordLinkPickerList';
import { Button, Modal } from './ui';

export type DeliveryDocumentRecord = {
  id: string;
  title: string;
  slug: string;
  humanKey?: string | null;
  recordType?: string | null;
};

export async function saveDeliveryDocumentLinks(input: {
  projectId: string;
  entityType: 'epic' | 'user_story' | 'milestone' | 'task' | 'sprint';
  entityId: string;
  recordIds: string[];
}): Promise<void> {
  const response = await fetch(
    `/api/v1/projects/${input.projectId}/delivery-document-links`,
    {
      method: 'PUT',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Origin: window.location.origin,
      },
      body: JSON.stringify({
        entityType: input.entityType,
        entityId: input.entityId,
        recordIds: input.recordIds,
      }),
    },
  );
  const payload = (await response.json().catch(() => ({}))) as {
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new Error(payload.error?.message || 'Failed to update documents');
  }
}

export function DeliveryDocumentsEditor({
  records,
  linkedRecords = [],
  linkedIds,
  onChange,
  canEdit,
  disabled = false,
  onPickerOpenChange,
}: {
  records: DeliveryDocumentRecord[];
  linkedRecords?: DeliveryDocumentRecord[];
  linkedIds: string[];
  onChange: (recordIds: string[]) => void;
  canEdit: boolean;
  disabled?: boolean;
  onPickerOpenChange?: (open: boolean) => void;
}) {
  const t = useTranslations('raid');
  const tRecords = useTranslations('records');
  const tCommon = useTranslations('common');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [addIds, setAddIds] = useState<string[]>([]);
  const [removeIds, setRemoveIds] = useState<string[]>([]);

  function recordTypeLabel(recordType: string): string {
    const key = `typeLabels.${recordType}` as 'typeLabels.note';
    return tRecords.has(key) ? tRecords(key) : recordType;
  }

  function setOpen(open: boolean) {
    setPickerOpen(open);
    onPickerOpenChange?.(open);
    if (open) {
      setAddIds([]);
    }
  }

  const catalog = new Map(records.map((record) => [record.id, record]));
  for (const record of linkedRecords) {
    if (!catalog.has(record.id)) catalog.set(record.id, record);
  }
  const linked = linkedIds
    .map((id) => catalog.get(id))
    .filter((row): row is DeliveryDocumentRecord => Boolean(row));
  const documentTypes = [...new Set(
    records.map((row) => row.recordType).filter((type): type is string => Boolean(type)),
  )].sort((left, right) => recordTypeLabel(left).localeCompare(recordTypeLabel(right)));
  const loadAvailable = useCallback(async (input: RecordLinkPickerQuery) => {
    const needle = input.q.trim().toLowerCase();
    const available = records.filter((row) => {
      if (linkedIds.includes(row.id)) return false;
      if (input.recordType !== 'all' && row.recordType !== input.recordType) return false;
      if (!needle) return true;
      const typeKey = row.recordType
        ? `typeLabels.${row.recordType}` as 'typeLabels.note'
        : null;
      const typeLabel = typeKey && tRecords.has(typeKey) ? tRecords(typeKey) : (row.recordType ?? '');
      return `${row.humanKey ?? ''} ${row.title} ${typeLabel}`.toLowerCase().includes(needle);
    });
    const emptyKind = needle || input.recordType !== 'all'
      ? 'none' as const
      : records.length === 0
        ? 'empty' as const
        : 'allLinked' as const;
    return {
      items: available.slice(input.offset, input.offset + input.limit),
      total: available.length,
      emptyKind,
    };
  }, [linkedIds, records, tRecords]);
  const editable = canEdit && !disabled;

  return (
    <>
      <div className="grid gap-3">
        {editable ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
              {t('documentsAdd')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={removeIds.length === 0}
              onClick={() => {
                onChange(linkedIds.filter((id) => !removeIds.includes(id)));
                setRemoveIds([]);
              }}
            >
              {t('documentsRemove')}
            </Button>
          </div>
        ) : null}
        {linked.length === 0 ? (
          <p className="m-0 text-sm text-ink-muted">{t('documentsReadOnlyEmpty')}</p>
        ) : (
          <ul className="m-0 grid list-none gap-2 p-0">
            {linked.map((row) => (
              <li key={row.id} className="kh-ops-linked-row kh-ops-linked-row-start">
                {editable ? (
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={removeIds.includes(row.id)}
                    onChange={() => {
                      setRemoveIds((prev) => (
                        prev.includes(row.id)
                          ? prev.filter((id) => id !== row.id)
                          : [...prev, row.id]
                      ));
                    }}
                    aria-label={t('documentsSelect', { title: row.title })}
                  />
                ) : null}
                <span>
                  {row.humanKey ? (
                    <span className="text-ink-muted">{row.humanKey} · </span>
                  ) : null}
                  {row.slug ? (
                    <LinkedKnowledgeRecord slug={row.slug} title={row.title} />
                  ) : (
                    row.title
                  )}
                  {row.recordType ? (
                    <span className="text-ink-muted"> · {recordTypeLabel(row.recordType)}</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <Modal
        open={pickerOpen}
        onClose={() => setOpen(false)}
        size="wide"
        title={t('documentsAddTitle')}
        description={t('documentsAddDescription')}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {tCommon('cancel')}
            </Button>
            <Button
              type="button"
              disabled={addIds.length === 0}
              onClick={() => {
                onChange([...new Set([...linkedIds, ...addIds])]);
                setOpen(false);
              }}
            >
              {t('documentsAddConfirm')}
            </Button>
          </>
        }
      >
        <RecordLinkPickerList
          active={pickerOpen}
          load={loadAvailable}
          requestKey={records.map((row) => row.id).join(',') + '|' + linkedIds.join(',')}
          typeOptions={documentTypes}
          selectedIds={addIds}
          onToggle={(id) => {
            setAddIds((prev) => (
              prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
            ));
          }}
        />
      </Modal>
    </>
  );
}
