'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { RECORD_TYPES } from '@project-knowledge-hub/domain';
import { cn } from '../../lib/cn';
import { LinkedKnowledgeRecord } from '../LinkedKnowledgeRecord';
import {
  RecordLinkPickerList,
  type RecordLinkPickerQuery,
} from '../RecordLinkPickerList';
import {
  Badge,
  Button,
  Field,
  Modal,
  Select,
  lifecycleLabel,
  lifecycleTone,
  useToast,
} from '../ui';

const RELATION_TYPES = [
  'relates_to',
  'depends_on',
  'refines',
  'derived_from',
  'contradicts',
] as const;

type RelationType = (typeof RELATION_TYPES)[number];

const FAMILIES = [
  'relates_to',
  'depends_on',
  'refines',
  'derived_from',
  'contradicts',
] as const;

const FAMILY_OF: Record<string, (typeof FAMILIES)[number]> = {
  relates_to: 'relates_to',
  depends_on: 'depends_on',
  required_by: 'depends_on',
  refines: 'refines',
  refined_by: 'refines',
  derived_from: 'derived_from',
  source_for: 'derived_from',
  contradicts: 'contradicts',
};

export type RelationRecordCard = {
  id: string;
  humanKey: string | null;
  title: string;
  slug: string;
  recordType: string;
  lifecycleStatus: string;
  archivedAt: string | null;
};

export type KnowledgeRecordRelationsPayload = {
  relations: {
    outbound: Array<{ relationType: string; record: RelationRecordCard }>;
    inbound: Array<{ relationType: string; record: RelationRecordCard }>;
  };
  lifecycleSuccessor: RelationRecordCard | null;
  lifecyclePredecessor: RelationRecordCard | null;
};

type OwnedLink = {
  targetRecordId: string;
  relationType: RelationType;
  record: RelationRecordCard;
};

function isRelationType(value: string): value is RelationType {
  return (RELATION_TYPES as readonly string[]).includes(value);
}

export function countRelatedEntries(
  payload: KnowledgeRecordRelationsPayload | null,
): number {
  if (!payload) {
    return 0;
  }
  return (
    payload.relations.outbound.length + payload.relations.inbound.length
  );
}

export function KnowledgeRecordRelationsPanel({
  recordId,
  workspaceId,
  projectId,
  canEdit,
  initial,
  embedded = false,
  supplyAddButton,
}: {
  recordId: string;
  workspaceId: string;
  projectId: string | null;
  canEdit: boolean;
  initial: KnowledgeRecordRelationsPayload | null;
  /** Collapsible document toolbar: compact list without section title. */
  embedded?: boolean;
  /** When embedded, renders the add-relation control in the document toolbar. */
  supplyAddButton?: (button: ReactNode) => void;
}) {
  const t = useTranslations('records');
  const tCommon = useTranslations('common');
  const { pushToast } = useToast();
  const [view, setView] = useState(initial);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [relationType, setRelationType] = useState<RelationType>('relates_to');
  const [targetId, setTargetId] = useState('');
  const [saving, setSaving] = useState(false);

  const openPicker = useCallback(() => {
    setTargetId('');
    setRelationType('relates_to');
    setPickerOpen(true);
  }, []);

  const addButton = useMemo(() => {
    if (!canEdit) {
      return null;
    }
    return (
      <Button
        type="button"
        variant="secondary"
        className="text-sm"
        disabled={saving}
        onClick={openPicker}
      >
        {t('relatedRecordsAdd')}
      </Button>
    );
  }, [canEdit, openPicker, saving, t]);

  useEffect(() => {
    if (!embedded || !supplyAddButton) {
      return;
    }
    supplyAddButton(addButton);
    return () => supplyAddButton(null);
  }, [addButton, embedded, supplyAddButton]);

  function relationLabel(type: string): string {
    const key = `relationTypes.${type}` as 'relationTypes.relates_to';
    return t.has(key) ? t(key) : type;
  }

  const owned = useMemo<OwnedLink[]>(() => {
    if (!view) return [];
    return view.relations.outbound.flatMap((edge) => {
      if (!isRelationType(edge.relationType)) return [];
      return [
        {
          targetRecordId: edge.record.id,
          relationType: edge.relationType,
          record: edge.record,
        },
      ];
    });
  }, [view]);

  const excludeIds = useMemo(() => {
    const ids = new Set<string>([recordId]);
    for (const link of owned) {
      if (link.relationType === relationType) {
        ids.add(link.targetRecordId);
      }
    }
    return [...ids];
  }, [owned, recordId, relationType]);

  const loadCandidates = useCallback(async (input: RecordLinkPickerQuery) => {
    const params = new URLSearchParams({
      workspaceId,
      limit: String(input.limit),
      offset: String(input.offset),
    });
    if (projectId) {
      params.set('projectId', projectId);
    } else {
      params.set('workspaceLevel', 'true');
    }
    if (input.q) {
      params.set('q', input.q);
    }
    if (input.recordType !== 'all') {
      params.set('recordType', input.recordType);
    }
    if (excludeIds.length > 0) {
      params.set('excludeIds', excludeIds.join(','));
    }
    const response = await fetch(`/api/v1/knowledge-records?${params.toString()}`, {
      credentials: 'include',
    });
    const payload = (await response.json().catch(() => ({}))) as {
      knowledgeRecords?: Array<{
        id: string;
        title: string;
        humanKey?: string | null;
        recordType?: string | null;
      }>;
      total?: number;
      error?: { message?: string };
    };
    if (!response.ok) {
      throw new Error(payload.error?.message || t('relatedRecordsPickerFailed'));
    }
    const items = (payload.knowledgeRecords ?? []).map((row) => ({
      id: row.id,
      title: row.title,
      humanKey: row.humanKey ?? null,
      recordType: row.recordType ?? null,
    }));
    return {
      items,
      total: payload.total ?? items.length,
      emptyKind: input.q || input.recordType !== 'all' ? 'none' as const : 'empty' as const,
    };
  }, [excludeIds, projectId, t, workspaceId]);

  async function save(links: Array<{ targetRecordId: string; relationType: RelationType }>) {
    setSaving(true);
    try {
      const response = await fetch(
        `/api/v1/knowledge-records/${recordId}/relations`,
        {
          method: 'PUT',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            Origin: window.location.origin,
          },
          body: JSON.stringify({ links }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as
        KnowledgeRecordRelationsPayload & { error?: { message?: string } };
      if (!response.ok) {
        throw new Error(payload.error?.message || t('relatedRecordsFailedSave'));
      }
      setView(payload);
      pushToast(t('relatedRecordsSaved'), 'success');
    } catch (error) {
      pushToast(
        error instanceof Error ? error.message : t('relatedRecordsFailedSave'),
        'danger',
      );
    } finally {
      setSaving(false);
    }
  }

  const groups = FAMILIES.map((family) => {
    const outbound = (view?.relations.outbound ?? []).filter(
      (edge) => (FAMILY_OF[edge.relationType] ?? edge.relationType) === family,
    );
    const inbound = (view?.relations.inbound ?? []).filter(
      (edge) => (FAMILY_OF[edge.relationType] ?? edge.relationType) === family,
    );
    return { family, outbound, inbound };
  }).filter((group) => group.outbound.length > 0 || group.inbound.length > 0);

  const empty = groups.length === 0;

  const sectionClassName = embedded
    ? 'kh-ops-related-records is-compact'
    : 'kh-ops-related-records';

  return (
    <section
      className={sectionClassName}
      aria-labelledby={embedded ? undefined : 'related-records-heading'}
    >
      {!embedded ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="related-records-heading">{t('relatedRecords')}</h2>
          {addButton}
        </div>
      ) : null}
      {!view ? (
        <p className="m-0 text-sm text-ink-muted">{t('relatedRecordsFailedLoad')}</p>
      ) : empty ? (
        <p className="m-0 text-sm text-ink-muted">{t('relatedRecordsEmpty')}</p>
      ) : (
        <div
          className={cn(
            'grid gap-4',
            embedded ? 'kh-ops-related-records-scroll' : undefined,
          )}
        >
          {groups.map((group) => (
            <div key={group.family} className="grid gap-2">
              <h3 className="text-ink">
                {relationLabel(group.family)}
              </h3>
              {group.outbound.length > 0 ? (
                <RelationSubsection
                  label={embedded ? undefined : t('relatedRecordsOutbound')}
                  edges={group.outbound}
                  relationLabel={relationLabel}
                  canRemove={canEdit}
                  saving={saving}
                  compact={embedded}
                  onRemove={(edge) => {
                    void save(
                      owned
                        .filter(
                          (link) =>
                            !(
                              link.targetRecordId === edge.record.id
                              && link.relationType === edge.relationType
                            ),
                        )
                        .map((link) => ({
                          targetRecordId: link.targetRecordId,
                          relationType: link.relationType,
                        })),
                    );
                  }}
                />
              ) : null}
              {group.inbound.length > 0 ? (
                <RelationSubsection
                  label={embedded ? undefined : t('relatedRecordsInbound')}
                  hint={embedded ? undefined : t('relatedRecordsInboundHint')}
                  edges={group.inbound}
                  relationLabel={relationLabel}
                  canRemove={false}
                  saving={saving}
                  compact={embedded}
                  onRemove={() => undefined}
                />
              ) : null}
            </div>
          ))}
        </div>
      )}
      <Modal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        size="wide"
        title={t('relatedRecordsAdd')}
        description={t('relatedRecordsSearch')}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setPickerOpen(false)}>
              {tCommon('cancel')}
            </Button>
            <Button
              type="button"
              disabled={!targetId || saving}
              onClick={() => {
                if (!targetId) return;
                setPickerOpen(false);
                void save([
                  ...owned.map((link) => ({
                    targetRecordId: link.targetRecordId,
                    relationType: link.relationType,
                  })),
                  { targetRecordId: targetId, relationType },
                ]);
              }}
            >
              {t('relatedRecordsAdd')}
            </Button>
          </>
        }
      >
        <div className="grid gap-3">
          <Field label={t('relatedRecordsType')}>
            <Select
              value={relationType}
              onChange={(event) => {
                const next = event.target.value;
                if (isRelationType(next)) setRelationType(next);
              }}
            >
              {RELATION_TYPES.map((type) => (
                <option key={type} value={type}>
                  {relationLabel(type)}
                </option>
              ))}
            </Select>
          </Field>
          <RecordLinkPickerList
            active={pickerOpen}
            load={loadCandidates}
            requestKey={`${relationType}:${excludeIds.join(',')}`}
            typeOptions={[...RECORD_TYPES]}
            selectedIds={targetId ? [targetId] : []}
            onToggle={(id) => setTargetId(id)}
            selection="single"
            radioName="relation-target"
            keyStyle="badge"
            debounceMs={200}
            placeholder={t('relatedRecordsSearch')}
            emptyLabel={t('relatedRecordsPickerEmpty')}
            noneLabel={t('relatedRecordsPickerNone')}
            failedLabel={t('relatedRecordsPickerFailed')}
          />
        </div>
      </Modal>
    </section>
  );
}

function RelationSubsection({
  label,
  hint,
  edges,
  relationLabel,
  canRemove,
  saving,
  compact,
  onRemove,
}: {
  label?: string;
  hint?: string;
  edges: Array<{ relationType: string; record: RelationRecordCard }>;
  relationLabel: (type: string) => string;
  canRemove: boolean;
  saving: boolean;
  compact?: boolean;
  onRemove: (edge: { relationType: string; record: RelationRecordCard }) => void;
}) {
  const t = useTranslations('records');
  return (
    <div className="grid gap-1">
      {label ? (
        <p className="m-0 text-xs text-ink-muted">
          {label}
          {hint ? ` — ${hint}` : ''}
        </p>
      ) : null}
      <ul className="m-0 list-none p-0">
        {edges.map((edge) => (
          <li
            key={`${edge.relationType}-${edge.record.id}`}
            className="kh-ops-linked-row kh-ops-linked-row-start"
          >
            {edge.record.humanKey ? (
              <span className="kh-ops-key-badge">{edge.record.humanKey}</span>
            ) : null}
            <LinkedKnowledgeRecord slug={edge.record.slug} title={edge.record.title} />
            {!compact ? (
              <Badge tone="neutral">{relationLabel(edge.relationType)}</Badge>
            ) : null}
            {!compact ? (
              <Badge tone={lifecycleTone(edge.record.lifecycleStatus)}>
                {lifecycleLabel(edge.record.lifecycleStatus, t)}
              </Badge>
            ) : null}
            {!compact && edge.record.archivedAt ? (
              <Badge tone="warn">{t('lifecycleLabels.archived')}</Badge>
            ) : null}
            {canRemove ? (
              <Button
                type="button"
                variant="secondary"
                disabled={saving}
                onClick={() => onRemove(edge)}
              >
                {t('relatedRecordsRemove')}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
