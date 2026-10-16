'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { LinkedKnowledgeRecord } from '../LinkedKnowledgeRecord';
import {
  Badge,
  Button,
  Field,
  Input,
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

type CatalogueRecord = {
  id: string;
  title: string;
  slug: string;
  humanKey?: string | null;
  recordType: string;
  lifecycleStatus: string;
  projectId: string | null;
  archivedAt: string | null;
};

type OwnedLink = {
  targetRecordId: string;
  relationType: RelationType;
  record: RelationRecordCard;
};

function isRelationType(value: string): value is RelationType {
  return (RELATION_TYPES as readonly string[]).includes(value);
}

export function KnowledgeRecordRelationsPanel({
  recordId,
  projectId,
  canEdit,
  initial,
  catalogue,
}: {
  recordId: string;
  projectId: string | null;
  canEdit: boolean;
  initial: KnowledgeRecordRelationsPayload | null;
  catalogue: CatalogueRecord[];
}) {
  const t = useTranslations('records');
  const tCommon = useTranslations('common');
  const { pushToast } = useToast();
  const [view, setView] = useState(initial);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [relationType, setRelationType] = useState<RelationType>('relates_to');
  const [targetId, setTargetId] = useState('');
  const [saving, setSaving] = useState(false);

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

  const candidates = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return catalogue.filter((row) => {
      if (row.id === recordId || row.archivedAt) return false;
      if (projectId) {
        if (row.projectId !== projectId) return false;
      } else if (row.projectId) {
        return false;
      }
      if (
        owned.some(
          (link) =>
            link.targetRecordId === row.id && link.relationType === relationType,
        )
      ) {
        return false;
      }
      if (!needle) return true;
      return `${row.humanKey ?? ''} ${row.title} ${row.recordType}`
        .toLowerCase()
        .includes(needle);
    });
  }, [catalogue, owned, projectId, query, recordId, relationType]);

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

  return (
    <section className="kh-ops-related-records" aria-labelledby="related-records-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="related-records-heading">{t('relatedRecords')}</h2>
        {canEdit ? (
          <Button
            type="button"
            variant="secondary"
            disabled={saving}
            onClick={() => {
              setQuery('');
              setTargetId('');
              setRelationType('relates_to');
              setPickerOpen(true);
            }}
          >
            {t('relatedRecordsAdd')}
          </Button>
        ) : null}
      </div>
      {!view ? (
        <p className="m-0 text-sm text-ink-muted">{t('relatedRecordsFailedLoad')}</p>
      ) : empty ? (
        <p className="m-0 text-sm text-ink-muted">{t('relatedRecordsEmpty')}</p>
      ) : (
        <div className="grid gap-4">
          {groups.map((group) => (
            <div key={group.family} className="grid gap-2">
              <h3 className="text-ink">
                {relationLabel(group.family)}
              </h3>
              {group.outbound.length > 0 ? (
                <RelationSubsection
                  label={t('relatedRecordsOutbound')}
                  edges={group.outbound}
                  relationLabel={relationLabel}
                  canRemove={canEdit}
                  saving={saving}
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
                  label={t('relatedRecordsInbound')}
                  hint={t('relatedRecordsInboundHint')}
                  edges={group.inbound}
                  relationLabel={relationLabel}
                  canRemove={false}
                  saving={saving}
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
                const target = catalogue.find((row) => row.id === targetId);
                if (!target) return;
                setPickerOpen(false);
                void save([
                  ...owned.map((link) => ({
                    targetRecordId: link.targetRecordId,
                    relationType: link.relationType,
                  })),
                  { targetRecordId: target.id, relationType },
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
          <Field label={t('relatedRecordsSearch')}>
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('relatedRecordsSearch')}
            />
          </Field>
          <ul className="m-0 grid max-h-80 list-none gap-1 overflow-auto p-0">
            {candidates.slice(0, 50).map((row) => (
              <li key={row.id}>
                <label className="kh-ops-linked-row kh-ops-linked-row-start">
                  <input
                    type="radio"
                    name="relation-target"
                    checked={targetId === row.id}
                    onChange={() => setTargetId(row.id)}
                  />
                  <span>
                    {row.humanKey ? (
                      <span className="kh-ops-key-badge mr-2">{row.humanKey}</span>
                    ) : null}
                    {row.title}
                  </span>
                </label>
              </li>
            ))}
          </ul>
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
  onRemove,
}: {
  label: string;
  hint?: string;
  edges: Array<{ relationType: string; record: RelationRecordCard }>;
  relationLabel: (type: string) => string;
  canRemove: boolean;
  saving: boolean;
  onRemove: (edge: { relationType: string; record: RelationRecordCard }) => void;
}) {
  const t = useTranslations('records');
  return (
    <div className="grid gap-1">
      <p className="m-0 text-xs text-ink-muted">
        {label}
        {hint ? ` — ${hint}` : ''}
      </p>
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
            <Badge tone="neutral">{relationLabel(edge.relationType)}</Badge>
            <Badge tone={lifecycleTone(edge.record.lifecycleStatus)}>
              {lifecycleLabel(edge.record.lifecycleStatus, t)}
            </Badge>
            {edge.record.archivedAt ? (
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
