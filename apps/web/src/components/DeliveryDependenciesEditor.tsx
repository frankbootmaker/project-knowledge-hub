'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  DeliveryItemLinkPicker,
  type DeliveryPickerItem,
} from './DeliveryItemLinkPicker';
import { Button, ErrorText, Field, Input, Modal, Select } from './ui';

const LINK_TYPES = ['FS', 'SS', 'FF', 'SF'] as const;

type LinkType = (typeof LINK_TYPES)[number];

type EntityType = 'epic' | 'user_story' | 'task' | 'milestone' | 'sprint';

type Endpoint = {
  entityType: EntityType;
  id: string;
  title: string;
  humanKey: string | null;
  itemType: 'task' | 'bug' | null;
};

type DependencyLink = {
  id: string;
  linkType: LinkType;
  lagDays: number;
  predecessor: Endpoint;
  successor: Endpoint;
};

export type DeliveryScheduleWrite = {
  entityType: string;
  id: string;
  startDate: string | null;
  finishDate: string | null;
  durationDays: number | null;
};

export type DeliveryPredecessorRef = {
  entityType: EntityType;
  id: string;
  status: string | null;
};

async function readError(response: Response, fallback: string): Promise<string> {
  const payload = (await response.json().catch(() => ({}))) as {
    error?: { message?: string };
  };
  return payload.error?.message || fallback;
}

function itemKey(entityType: string, id: string): string {
  return `${entityType}:${id}`;
}

function splitItemKey(key: string): { entityType: EntityType; id: string } | null {
  const splitAt = key.indexOf(':');
  if (splitAt < 0) return null;
  const entityType = key.slice(0, splitAt);
  const id = key.slice(splitAt + 1);
  if (
    entityType !== 'epic'
    && entityType !== 'user_story'
    && entityType !== 'task'
    && entityType !== 'milestone'
    && entityType !== 'sprint'
  ) {
    return null;
  }
  return { entityType, id };
}

export function DeliveryDependenciesEditor({
  projectId,
  entityType,
  entityId,
  canEdit,
  onScheduleDriven,
  onScheduled,
  onPredecessors,
}: {
  projectId: string;
  entityType: EntityType;
  entityId: string;
  canEdit: boolean;
  onScheduleDriven?: (driven: boolean) => void;
  onScheduled?: (write: DeliveryScheduleWrite | null) => void;
  onPredecessors?: (items: DeliveryPredecessorRef[]) => void;
}) {
  const t = useTranslations('delivery');
  const tRaid = useTranslations('raid');
  const tCommon = useTranslations('common');
  const [predecessors, setPredecessors] = useState<DependencyLink[]>([]);
  const [successors, setSuccessors] = useState<DependencyLink[]>([]);
  const [catalog, setCatalog] = useState<DeliveryPickerItem[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [addIds, setAddIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const applySchedule = useCallback(
    (schedule: DeliveryScheduleWrite[] | undefined) => {
      const mine = schedule?.find(
        (row) => row.entityType === entityType && row.id === entityId,
      );
      onScheduled?.(mine ?? null);
    },
    [entityId, entityType, onScheduled],
  );

  const loadLinks = useCallback(async () => {
    const params = new URLSearchParams({
      entityId,
      entityType,
    });
    const response = await fetch(
      `/api/v1/projects/${projectId}/delivery-dependencies?${params.toString()}`,
    );
    if (!response.ok) {
      throw new Error(await readError(response, t('dependenciesFailed')));
    }
    const payload = (await response.json()) as {
      predecessors?: DependencyLink[];
      successors?: DependencyLink[];
      scheduleDriven?: boolean;
    };
    setPredecessors(payload.predecessors ?? []);
    setSuccessors(payload.successors ?? []);
    onScheduleDriven?.(Boolean(payload.scheduleDriven));
  }, [entityId, entityType, onScheduleDriven, projectId, t]);

  const loadCatalog = useCallback(async () => {
    const [epics, stories, milestones, sprints, tasks] = await Promise.all([
      fetch(`/api/v1/projects/${projectId}/epics`).then((response) => response.json()),
      fetch(`/api/v1/projects/${projectId}/user-stories`).then((response) => response.json()),
      fetch(`/api/v1/projects/${projectId}/milestones`).then((response) => response.json()),
      fetch(`/api/v1/projects/${projectId}/sprints`).then((response) => response.json()),
      fetch(`/api/v1/projects/${projectId}/tasks`).then((response) => response.json()),
    ]);
    const next: DeliveryPickerItem[] = [];
    const push = (
      type: EntityType,
      row: {
        id: string;
        title?: string;
        name?: string;
        humanKey?: string | null;
        status?: string | null;
        itemType?: string | null;
      },
    ) => {
      next.push({
        id: itemKey(type, row.id),
        entityType: type,
        title: row.title ?? row.name ?? row.id,
        humanKey: row.humanKey ?? null,
        status: row.status ?? null,
        itemType: row.itemType ?? null,
      });
    };
    for (const row of (epics.epics ?? []) as Array<{ id: string; title: string; humanKey?: string | null; status?: string }>) {
      push('epic', row);
    }
    for (const row of (stories.userStories ?? []) as Array<{ id: string; title: string; humanKey?: string | null; status?: string }>) {
      push('user_story', row);
    }
    for (const row of (milestones.milestones ?? []) as Array<{ id: string; title: string; humanKey?: string | null; status?: string }>) {
      push('milestone', row);
    }
    for (const row of (sprints.sprints ?? []) as Array<{ id: string; name: string; humanKey?: string | null; status?: string }>) {
      push('sprint', row);
    }
    for (const row of (tasks.tasks ?? []) as Array<{
      id: string;
      title: string;
      humanKey?: string | null;
      status?: string;
      itemType?: string;
    }>) {
      push('task', row);
    }
    setCatalog(next.sort((a, b) => a.title.localeCompare(b.title)));
  }, [projectId]);

  useEffect(() => {
    if (!onPredecessors) return;
    onPredecessors(predecessors.map((link) => {
      const match = catalog.find((item) => item.id === itemKey(
        link.predecessor.entityType,
        link.predecessor.id,
      ));
      return {
        entityType: link.predecessor.entityType,
        id: link.predecessor.id,
        status: match?.status ?? null,
      };
    }));
  }, [catalog, onPredecessors, predecessors]);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    void Promise.all([loadLinks(), loadCatalog()]).catch((err: unknown) => {
      if (!cancelled) {
        setError(err instanceof Error ? err.message : t('dependenciesFailed'));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [loadCatalog, loadLinks, t]);

  function toggleAdd(id: string) {
    setAddIds((prev) => (
      prev.includes(id) ? prev.filter((row) => row !== id) : [...prev, id]
    ));
  }

  async function confirmAdd() {
    const links = addIds.flatMap((key) => {
      const predecessor = splitItemKey(key);
      if (!predecessor) return [];
      return [{
        predecessorId: predecessor.id,
        predecessorType: predecessor.entityType,
        successorId: entityId,
        successorType: entityType,
        linkType: 'FS' as const,
        lagDays: 0,
      }];
    });
    if (links.length === 0) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/v1/projects/${projectId}/delivery-dependencies`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ links }),
        },
      );
      if (!response.ok) {
        throw new Error(await readError(response, t('dependenciesFailed')));
      }
      const payload = (await response.json()) as {
        schedule?: DeliveryScheduleWrite[];
      };
      setPickerOpen(false);
      setAddIds([]);
      await loadLinks();
      applySchedule(payload.schedule);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('dependenciesFailed'));
    } finally {
      setPending(false);
    }
  }

  async function patchLink(
    linkId: string,
    body: { linkType?: LinkType; lagDays?: number },
  ) {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/v1/projects/${projectId}/delivery-dependencies/${linkId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      if (!response.ok) {
        throw new Error(await readError(response, t('dependenciesFailed')));
      }
      const payload = (await response.json()) as {
        schedule?: DeliveryScheduleWrite[];
      };
      await loadLinks();
      applySchedule(payload.schedule);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('dependenciesFailed'));
    } finally {
      setPending(false);
    }
  }

  async function removeLink(linkId: string) {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/v1/projects/${projectId}/delivery-dependencies/${linkId}`,
        { method: 'DELETE' },
      );
      if (!response.ok) {
        throw new Error(await readError(response, t('dependenciesFailed')));
      }
      const payload = (await response.json()) as {
        schedule?: DeliveryScheduleWrite[];
      };
      await loadLinks();
      applySchedule(payload.schedule);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('dependenciesFailed'));
    } finally {
      setPending(false);
    }
  }

  function successorLine(link: DependencyLink) {
    const item = link.successor;
    const name = item.humanKey ? `${item.humanKey} · ${item.title}` : item.title;
    const lag = link.lagDays === 0
      ? ''
      : ` ${link.lagDays > 0 ? '+' : ''}${link.lagDays}${t('lagSuffix')}`;
    return `${name} · ${t(`linkType.${link.linkType}`)}${lag}`;
  }

  const hiddenIds = [
    itemKey(entityType, entityId),
    ...predecessors.map((link) => itemKey(
      link.predecessor.entityType,
      link.predecessor.id,
    )),
  ];

  return (
    <div className="grid gap-4">
      <p className="m-0 text-sm text-ink-muted">{t('dependenciesHint')}</p>
      {error ? <ErrorText>{error}</ErrorText> : null}
      <section className="grid gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="m-0 text-sm font-semibold">{t('predecessors')}</h3>
          {canEdit ? (
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() => {
                setAddIds([]);
                setPickerOpen(true);
              }}
            >
              {t('addPredecessor')}
            </Button>
          ) : null}
        </div>
        {predecessors.length === 0 ? (
          <p className="m-0 text-sm text-ink-muted">{t('noPredecessors')}</p>
        ) : (
          <ul className="m-0 grid list-none gap-2 p-0">
            {predecessors.map((link) => (
              <PredecessorRow
                key={link.id}
                link={link}
                canEdit={canEdit}
                pending={pending}
                onType={(linkType) => void patchLink(link.id, { linkType })}
                onLag={(lagDays) => void patchLink(link.id, { lagDays })}
                onRemove={() => void removeLink(link.id)}
              />
            ))}
          </ul>
        )}
        <p className="m-0 text-xs text-ink-muted">{t('lagHint')}</p>
      </section>
      <section className="grid gap-2">
        <h3 className="m-0 text-sm font-semibold">{t('successors')}</h3>
        <p className="m-0 text-xs text-ink-muted">{t('successorsHint')}</p>
        {successors.length === 0 ? (
          <p className="m-0 text-sm text-ink-muted">{t('noSuccessors')}</p>
        ) : (
          <ul className="m-0 grid list-none gap-2 p-0">
            {successors.map((link) => (
              <li key={link.id} className="kh-ops-inset text-sm">
                {successorLine(link)}
              </li>
            ))}
          </ul>
        )}
      </section>
      <Modal
        open={pickerOpen}
        onClose={() => {
          if (!pending) setPickerOpen(false);
        }}
        size="wide"
        title={tRaid('tasksAddTitle')}
        description={tRaid('tasksAddDescription')}
        footer={(
          <>
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() => setPickerOpen(false)}
            >
              {tCommon('cancel')}
            </Button>
            <Button
              type="button"
              disabled={pending || addIds.length === 0}
              onClick={() => void confirmAdd()}
            >
              {tRaid('documentsAddConfirm')}
            </Button>
          </>
        )}
      >
        <DeliveryItemLinkPicker
          items={catalog}
          hiddenIds={hiddenIds}
          selectedIds={addIds}
          onToggle={toggleAdd}
          includeSprint
        />
      </Modal>
    </div>
  );
}

function PredecessorRow({
  link,
  canEdit,
  pending,
  onType,
  onLag,
  onRemove,
}: {
  link: DependencyLink;
  canEdit: boolean;
  pending: boolean;
  onType: (linkType: LinkType) => void;
  onLag: (lagDays: number) => void;
  onRemove: () => void;
}) {
  const t = useTranslations('delivery');
  const [lag, setLag] = useState(String(link.lagDays));

  useEffect(() => {
    setLag(String(link.lagDays));
  }, [link.lagDays]);

  const item = link.predecessor;
  const name = item.humanKey ? `${item.humanKey} · ${item.title}` : item.title;

  function commitLag() {
    const parsed = lag.trim() === '' ? 0 : Number(lag);
    if (!Number.isInteger(parsed)) {
      setLag(String(link.lagDays));
      return;
    }
    if (parsed === link.lagDays) return;
    onLag(parsed);
  }

  return (
    <li className="kh-ops-inset grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm">{name}</span>
        {canEdit ? (
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={onRemove}
          >
            {t('removeDependency')}
          </Button>
        ) : (
          <span className="text-sm text-ink-muted">
            {t(`linkType.${link.linkType}`)}
            {link.lagDays === 0
              ? ''
              : ` ${link.lagDays > 0 ? '+' : ''}${link.lagDays}${t('lagSuffix')}`}
          </span>
        )}
      </div>
      {canEdit ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label={t('linkTypeLabel')}>
            <Select
              value={link.linkType}
              disabled={pending}
              onChange={(event) => onType(event.target.value as LinkType)}
            >
              {LINK_TYPES.map((value) => (
                <option key={value} value={value}>
                  {t(`linkType.${value}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('lagDays')}>
            <Input
              type="number"
              step="1"
              min={-3650}
              max={3650}
              value={lag}
              disabled={pending}
              onChange={(event) => setLag(event.target.value)}
              onBlur={commitLag}
            />
          </Field>
        </div>
      ) : null}
    </li>
  );
}
