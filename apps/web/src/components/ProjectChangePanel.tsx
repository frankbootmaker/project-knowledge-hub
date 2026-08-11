'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  CatalogueSection,
  type CatalogueListItem,
} from './CatalogueSection';
import { CollapsibleSection } from './CollapsibleSection';
import {
  Badge,
  Button,
  ErrorText,
  Field,
  Input,
  Modal,
  Panel,
  Select,
  Textarea,
  useToast,
} from './ui';

export type ChangeDeliveryLink = {
  entityType: string;
  entityId: string;
  entityTitle: string | null;
};

export type ChangeItem = {
  id: string;
  kind: string;
  title: string;
  description: string | null;
  rationale: string | null;
  status: string;
  requestedByUserId: string | null;
  requestedBy: { userId: string; displayName: string; email: string } | null;
  approvedByUserId: string | null;
  approvedBy: { userId: string; displayName: string; email: string } | null;
  requestedAt: string;
  decidedAt: string | null;
  effectiveDate: string | null;
  baselineStartBefore: string | null;
  baselineStartAfter: string | null;
  baselineEndBefore: string | null;
  baselineEndAfter: string | null;
  knowledgeRecordId: string | null;
  knowledgeRecordTitle: string | null;
  sortOrder: number;
  humanKey?: string | null;
  createdAt?: string;
  updatedAt?: string;
  deliveryLinks: ChangeDeliveryLink[];
};

type Member = { userId: string; displayName: string; email: string };
type DeliveryOption = {
  entityType: 'epic' | 'user_story' | 'milestone' | 'task';
  entityId: string;
  title: string;
};
type KnowledgeOption = { id: string; title: string; slug: string };

const KINDS = [
  'scope',
  'timeline',
  'stakeholder',
  'budget',
  'other',
] as const;
const STATUSES = [
  'proposed',
  'approved',
  'rejected',
  'implemented',
  'cancelled',
] as const;

function linkKey(link: { entityType: string; entityId: string }) {
  return `${link.entityType}:${link.entityId}`;
}

export function ProjectChangePanel({
  projectId,
  canMutate,
  initialChangeItems,
  members,
  deliveryOptions,
  knowledgeRecords,
}: {
  projectId: string;
  canMutate: boolean;
  initialChangeItems: ChangeItem[];
  members: Member[];
  deliveryOptions: DeliveryOption[];
  knowledgeRecords: KnowledgeOption[];
}) {
  const t = useTranslations('changes');
  const tCommon = useTranslations('common');
  const tWorkspaces = useTranslations('workspaces');
  const tArchive = useTranslations('archive');
  const router = useRouter();
  const { pushToast } = useToast();

  const [items, setItems] = useState(initialChangeItems);
  useEffect(() => {
    setItems(initialChangeItems);
  }, [initialChangeItems]);

  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [manageId, setManageId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteAcknowledged, setDeleteAcknowledged] = useState(false);

  const [kind, setKind] = useState<string>('scope');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [rationale, setRationale] = useState('');
  const [status, setStatus] = useState('proposed');
  const [requestedByUserId, setRequestedByUserId] = useState('');
  const [approvedByUserId, setApprovedByUserId] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [baselineStartBefore, setBaselineStartBefore] = useState('');
  const [baselineStartAfter, setBaselineStartAfter] = useState('');
  const [baselineEndBefore, setBaselineEndBefore] = useState('');
  const [baselineEndAfter, setBaselineEndAfter] = useState('');
  const [knowledgeRecordId, setKnowledgeRecordId] = useState('');
  const [deliveryLinks, setDeliveryLinks] = useState<
    Array<{ entityType: string; entityId: string }>
  >([]);

  const refresh = useCallback(() => {
    router.refresh();
  }, [router]);

  const managing = manageId
    ? items.find((item) => item.id === manageId) ?? null
    : null;

  function resetForm(seed?: ChangeItem | null) {
    setKind(seed?.kind ?? 'scope');
    setTitle(seed?.title ?? '');
    setDescription(seed?.description ?? '');
    setRationale(seed?.rationale ?? '');
    setStatus(seed?.status ?? 'proposed');
    setRequestedByUserId(seed?.requestedByUserId ?? '');
    setApprovedByUserId(seed?.approvedByUserId ?? '');
    setEffectiveDate(seed?.effectiveDate ?? '');
    setBaselineStartBefore(seed?.baselineStartBefore ?? '');
    setBaselineStartAfter(seed?.baselineStartAfter ?? '');
    setBaselineEndBefore(seed?.baselineEndBefore ?? '');
    setBaselineEndAfter(seed?.baselineEndAfter ?? '');
    setKnowledgeRecordId(seed?.knowledgeRecordId ?? '');
    setDeliveryLinks(
      seed?.deliveryLinks.map((link) => ({
        entityType: link.entityType,
        entityId: link.entityId,
      })) ?? [],
    );
    setConfirmDelete(false);
    setDeleteAcknowledged(false);
    setError(null);
  }

  useEffect(() => {
    if (manageId && managing) {
      resetForm(managing);
    }
  }, [manageId, managing?.id]);

  const catalogueItems: CatalogueListItem[] = useMemo(
    () =>
      items.map((item) => ({
        id: item.id,
        title: item.title,
        primaryBadge: item.humanKey ?? t(`kind.${item.kind}`),
        secondaryBadge: t(`status.${item.status}`),
        subtitle: [
          t(`kind.${item.kind}`),
          item.requestedBy?.displayName
            ? `${t('requestedBy')}: ${item.requestedBy.displayName}`
            : null,
          item.effectiveDate
            ? `${t('effectiveDate')}: ${item.effectiveDate}`
            : null,
          item.deliveryLinks.length > 0
            ? t('linkedDeliveryCount', { count: item.deliveryLinks.length })
            : null,
          item.knowledgeRecordTitle
            ? `${t('relatedRecord')}: ${item.knowledgeRecordTitle}`
            : null,
        ]
          .filter(Boolean)
          .join(' · '),
        updatedAt: item.updatedAt ?? item.createdAt ?? null,
        searchText: [
          item.title,
          item.humanKey ?? '',
          item.description ?? '',
          item.rationale ?? '',
          item.kind,
          item.status,
          item.requestedBy?.displayName ?? '',
          item.knowledgeRecordTitle ?? '',
          ...item.deliveryLinks.map((link) => link.entityTitle ?? ''),
        ]
          .join(' ')
          .toLowerCase(),
        filterValue: `${item.kind}:${item.status}`,
        filterLabel: `${t(`kind.${item.kind}`)} · ${t(`status.${item.status}`)}`,
      })),
    [items, t],
  );

  function toggleDeliveryLink(option: DeliveryOption) {
    const key = linkKey(option);
    setDeliveryLinks((prev) => {
      if (prev.some((link) => linkKey(link) === key)) {
        return prev.filter((link) => linkKey(link) !== key);
      }
      return [
        ...prev,
        { entityType: option.entityType, entityId: option.entityId },
      ];
    });
  }

  function payloadBody() {
    return {
      kind,
      title: title.trim(),
      description: description.trim() || null,
      rationale: rationale.trim() || null,
      status,
      requestedByUserId: requestedByUserId || null,
      approvedByUserId: approvedByUserId || null,
      effectiveDate: effectiveDate || null,
      baselineStartBefore: baselineStartBefore || null,
      baselineStartAfter: baselineStartAfter || null,
      baselineEndBefore: baselineEndBefore || null,
      baselineEndAfter: baselineEndAfter || null,
      knowledgeRecordId: knowledgeRecordId || null,
      deliveryLinks,
    };
  }

  async function submitCreate() {
    if (!canMutate || !title.trim()) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/v1/projects/${projectId}/change-items`,
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            Origin: window.location.origin,
          },
          body: JSON.stringify(payloadBody()),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        changeItem?: ChangeItem;
        error?: { message?: string };
      };
      if (!response.ok || !payload.changeItem) {
        throw new Error(payload.error?.message || t('failedCreate'));
      }
      setItems((prev) => [...prev, payload.changeItem!]);
      setCreateOpen(false);
      resetForm();
      pushToast(t('created'), 'success');
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('failedCreate'));
    } finally {
      setPending(false);
    }
  }

  async function submitUpdate() {
    if (!canMutate || !manageId || !title.trim()) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/v1/project-change-items/${manageId}`,
        {
          method: 'PATCH',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            Origin: window.location.origin,
          },
          body: JSON.stringify(payloadBody()),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        changeItem?: ChangeItem;
        error?: { message?: string };
      };
      if (!response.ok || !payload.changeItem) {
        throw new Error(payload.error?.message || t('failedUpdate'));
      }
      setItems((prev) =>
        prev.map((item) =>
          item.id === manageId ? payload.changeItem! : item,
        ),
      );
      setManageId(null);
      pushToast(t('updated'), 'success');
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('failedUpdate'));
    } finally {
      setPending(false);
    }
  }

  async function submitDelete() {
    if (!canMutate || !manageId || !deleteAcknowledged) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/v1/project-change-items/${manageId}`,
        {
          method: 'DELETE',
          credentials: 'include',
          headers: { Origin: window.location.origin },
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(payload.error?.message || t('failedDelete'));
      }
      setItems((prev) => prev.filter((item) => item.id !== manageId));
      setManageId(null);
      pushToast(t('deleted'), 'success');
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('failedDelete'));
    } finally {
      setPending(false);
      setConfirmDelete(false);
      setDeleteAcknowledged(false);
    }
  }

  function formFields(disabled: boolean) {
    return (
      <div className="grid gap-3">
        {error ? <ErrorText>{error}</ErrorText> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('kindLabel')}>
            <Select
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              disabled={disabled}
            >
              {KINDS.map((value) => (
                <option key={value} value={value}>
                  {t(`kind.${value}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('statusLabel')}>
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              disabled={disabled}
            >
              {STATUSES.map((value) => (
                <option key={value} value={value}>
                  {t(`status.${value}`)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label={t('itemTitle')}>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={disabled}
            data-modal-initial-focus
          />
        </Field>
        <Field label={t('description')}>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={disabled}
            rows={3}
          />
        </Field>
        <Field label={t('rationale')}>
          <Textarea
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
            disabled={disabled}
            rows={3}
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('requestedBy')}>
            <Select
              value={requestedByUserId}
              onChange={(e) => setRequestedByUserId(e.target.value)}
              disabled={disabled}
            >
              <option value="">{t('unassigned')}</option>
              {members.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.displayName}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('approvedBy')}>
            <Select
              value={approvedByUserId}
              onChange={(e) => setApprovedByUserId(e.target.value)}
              disabled={disabled}
            >
              <option value="">{t('unassigned')}</option>
              {members.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.displayName}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label={t('effectiveDate')}>
          <Input
            type="date"
            value={effectiveDate}
            onChange={(e) => setEffectiveDate(e.target.value)}
            disabled={disabled}
          />
        </Field>
        {kind === 'timeline' ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('baselineStartBefore')}>
              <Input
                type="date"
                value={baselineStartBefore}
                onChange={(e) => setBaselineStartBefore(e.target.value)}
                disabled={disabled}
              />
            </Field>
            <Field label={t('baselineStartAfter')}>
              <Input
                type="date"
                value={baselineStartAfter}
                onChange={(e) => setBaselineStartAfter(e.target.value)}
                disabled={disabled}
              />
            </Field>
            <Field label={t('baselineEndBefore')}>
              <Input
                type="date"
                value={baselineEndBefore}
                onChange={(e) => setBaselineEndBefore(e.target.value)}
                disabled={disabled}
              />
            </Field>
            <Field label={t('baselineEndAfter')}>
              <Input
                type="date"
                value={baselineEndAfter}
                onChange={(e) => setBaselineEndAfter(e.target.value)}
                disabled={disabled}
              />
            </Field>
          </div>
        ) : null}
        <Field label={t('relatedRecord')}>
          <Select
            value={knowledgeRecordId}
            onChange={(e) => setKnowledgeRecordId(e.target.value)}
            disabled={disabled}
          >
            <option value="">{tCommon('none')}</option>
            {knowledgeRecords.map((row) => (
              <option key={row.id} value={row.id}>
                {row.title}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('linkedDelivery')}>
          <div className="max-h-48 overflow-auto rounded-md border border-line p-2">
            {deliveryOptions.length === 0 ? (
              <p className="m-0 text-sm text-ink-muted">{t('noDelivery')}</p>
            ) : (
              <ul className="m-0 grid list-none gap-1 p-0">
                {deliveryOptions.map((option) => {
                  const key = linkKey(option);
                  const checked = deliveryLinks.some(
                    (link) => linkKey(link) === key,
                  );
                  return (
                    <li key={key}>
                      <label className="flex items-start gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={checked}
                          disabled={disabled}
                          onChange={() => toggleDeliveryLink(option)}
                        />
                        <span>
                          <Badge>{t(`entity.${option.entityType}`)}</Badge>{' '}
                          {option.title}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Field>
      </div>
    );
  }

  return (
    <>
      <CollapsibleSection
        id="project-change"
        storageKey={`project:${projectId}:changes`}
        title={t('title')}
        defaultOpen
      >
        {error && !createOpen && !manageId ? (
          <div className="mb-3">
            <ErrorText>{error}</ErrorText>
          </div>
        ) : null}

        <CatalogueSection
          className="mb-2"
          title={t('title')}
          showTitle={false}
          items={catalogueItems}
          emptyLabel={t('empty')}
          searchPlaceholder={t('searchPlaceholder')}
          filterLabel={t('filterLabel')}
          filterAllLabel={tWorkspaces('sectionFilterAll')}
          createLabel={t('addItem')}
          canCreate={canMutate}
          onCreate={() => {
            resetForm();
            setCreateOpen(true);
          }}
          renderItem={(item) => {
            const change = items.find((row) => row.id === item.id);
            return (
              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {change?.humanKey ? (
                      <Badge tone="brand" className="font-mono">
                        {change.humanKey}
                      </Badge>
                    ) : item.primaryBadge ? (
                      <Badge tone="brand">{item.primaryBadge}</Badge>
                    ) : null}
                    <span className="font-semibold">{item.title}</span>
                    {item.secondaryBadge ? (
                      <Badge>{item.secondaryBadge}</Badge>
                    ) : null}
                  </div>
                  {item.subtitle ? (
                    <p className="mt-2 mb-0 text-sm text-ink-muted">
                      {item.subtitle}
                    </p>
                  ) : null}
                  {change && change.deliveryLinks.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {change.deliveryLinks.map((link) => (
                        <Badge key={linkKey(link)}>
                          {link.entityTitle || link.entityId}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  className="w-full sm:w-auto"
                  onClick={() => setManageId(item.id)}
                >
                  {t('manage')}
                </Button>
              </div>
            );
          }}
        />
        <p className="mt-3 mb-0 text-xs text-ink-muted">
          {canMutate ? t('hint') : t('readOnlyHint')}
        </p>
      </CollapsibleSection>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title={t('addItem')}
        description={t('modalDescription')}
        size="lg"
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() => setCreateOpen(false)}
            >
              {tCommon('cancel')}
            </Button>
            <Button
              type="button"
              disabled={pending || !title.trim()}
              onClick={() => void submitCreate()}
            >
              {t('addItem')}
            </Button>
          </>
        }
      >
        {formFields(pending)}
      </Modal>

      <Modal
        open={Boolean(manageId)}
        onClose={() => setManageId(null)}
        title={title.trim() || t('manageItem')}
        description={t('manageDescription')}
        size="lg"
        footer={
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <div>
              {canMutate ? (
                !confirmDelete ? (
                  <Button
                    type="button"
                    variant="danger"
                    disabled={pending}
                    onClick={() => {
                      setConfirmDelete(true);
                      setDeleteAcknowledged(false);
                    }}
                  >
                    {t('deleteItem')}
                  </Button>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={pending}
                      onClick={() => {
                        setConfirmDelete(false);
                        setDeleteAcknowledged(false);
                      }}
                    >
                      {tCommon('cancel')}
                    </Button>
                    <Button
                      type="button"
                      variant="danger"
                      disabled={pending || !deleteAcknowledged}
                      onClick={() => void submitDelete()}
                    >
                      {t('confirmDelete')}
                    </Button>
                  </div>
                )
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setManageId(null)}
              >
                {tCommon('cancel')}
              </Button>
              {canMutate ? (
                <Button
                  type="button"
                  disabled={pending || !title.trim() || confirmDelete}
                  onClick={() => void submitUpdate()}
                >
                  {t('saveItem')}
                </Button>
              ) : null}
            </div>
          </div>
        }
      >
        {confirmDelete ? (
          <Panel
            variant="inset"
            className="mb-3 grid gap-3 border-danger/40 bg-danger/5"
          >
            <p className="m-0 text-sm font-semibold text-danger">
              {t('confirmDeleteTitle', {
                title: title.trim() || t('title'),
              })}
            </p>
            <p className="m-0 text-sm text-danger">{t('deleteHint')}</p>
            <label className="flex items-start gap-2 text-sm text-ink">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={deleteAcknowledged}
                disabled={pending}
                onChange={(e) => setDeleteAcknowledged(e.target.checked)}
              />
              <span>{tArchive('deleteAcknowledge')}</span>
            </label>
          </Panel>
        ) : null}
        {formFields(pending || confirmDelete || !canMutate)}
      </Modal>
    </>
  );
}
