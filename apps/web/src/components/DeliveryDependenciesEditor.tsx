'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, ErrorText, Field, Input, Select } from './ui';

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

type Option = {
  entityType: EntityType;
  id: string;
  label: string;
};

async function readError(response: Response, fallback: string): Promise<string> {
  const payload = (await response.json().catch(() => ({}))) as {
    error?: { message?: string };
  };
  return payload.error?.message || fallback;
}

function optionLabel(
  humanKey: string | null,
  title: string,
  kind: string,
): string {
  const key = humanKey ? `${humanKey} · ` : '';
  return `${key}${kind}: ${title}`;
}

export function DeliveryDependenciesEditor({
  projectId,
  entityType,
  entityId,
  canEdit,
  onScheduleDriven,
  onScheduled,
}: {
  projectId: string;
  entityType: EntityType;
  entityId: string;
  canEdit: boolean;
  onScheduleDriven?: (driven: boolean) => void;
  onScheduled?: (write: DeliveryScheduleWrite | null) => void;
}) {
  const t = useTranslations('delivery');
  const [predecessors, setPredecessors] = useState<DependencyLink[]>([]);
  const [successors, setSuccessors] = useState<DependencyLink[]>([]);
  const [options, setOptions] = useState<Option[]>([]);
  const [predecessorKey, setPredecessorKey] = useState('');
  const [linkType, setLinkType] = useState<LinkType>('FS');
  const [lagDays, setLagDays] = useState('0');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

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

  const loadOptions = useCallback(async () => {
    const [epics, stories, milestones, sprints, tasks] = await Promise.all([
      fetch(`/api/v1/projects/${projectId}/epics`).then((response) => response.json()),
      fetch(`/api/v1/projects/${projectId}/user-stories`).then((response) => response.json()),
      fetch(`/api/v1/projects/${projectId}/milestones`).then((response) => response.json()),
      fetch(`/api/v1/projects/${projectId}/sprints`).then((response) => response.json()),
      fetch(`/api/v1/projects/${projectId}/tasks`).then((response) => response.json()),
    ]);
    const next: Option[] = [];
    for (const row of (epics.epics ?? []) as Array<{ id: string; title: string; humanKey?: string | null }>) {
      next.push({
        entityType: 'epic',
        id: row.id,
        label: optionLabel(row.humanKey ?? null, row.title, t('kindEpic')),
      });
    }
    for (const row of (stories.userStories ?? []) as Array<{ id: string; title: string; humanKey?: string | null }>) {
      next.push({
        entityType: 'user_story',
        id: row.id,
        label: optionLabel(row.humanKey ?? null, row.title, t('kindStory')),
      });
    }
    for (const row of (milestones.milestones ?? []) as Array<{ id: string; title: string; humanKey?: string | null }>) {
      next.push({
        entityType: 'milestone',
        id: row.id,
        label: optionLabel(row.humanKey ?? null, row.title, t('kindMilestone')),
      });
    }
    for (const row of (sprints.sprints ?? []) as Array<{ id: string; name: string; humanKey?: string | null }>) {
      next.push({
        entityType: 'sprint',
        id: row.id,
        label: optionLabel(row.humanKey ?? null, row.name, t('scrumSprint')),
      });
    }
    for (const row of (tasks.tasks ?? []) as Array<{
      id: string;
      title: string;
      humanKey?: string | null;
      itemType?: string;
    }>) {
      next.push({
        entityType: 'task',
        id: row.id,
        label: optionLabel(
          row.humanKey ?? null,
          row.title,
          row.itemType === 'bug' ? t('kindBug') : t('kindTask'),
        ),
      });
    }
    setOptions(
      next
        .filter((row) => !(row.entityType === entityType && row.id === entityId))
        .sort((a, b) => a.label.localeCompare(b.label)),
    );
  }, [entityId, entityType, projectId, t]);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    void Promise.all([loadLinks(), loadOptions()]).catch((err: unknown) => {
      if (!cancelled) {
        setError(err instanceof Error ? err.message : t('dependenciesFailed'));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [loadLinks, loadOptions, t]);

  async function addPredecessor() {
    const selected = options.find((row) => `${row.entityType}:${row.id}` === predecessorKey);
    if (!selected) return;
    const lag = lagDays.trim() === '' ? 0 : Number(lagDays);
    if (!Number.isInteger(lag)) {
      setError(t('lagInvalid'));
      return;
    }
    setPending(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/v1/projects/${projectId}/delivery-dependencies`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            predecessorId: selected.id,
            predecessorType: selected.entityType,
            successorId: entityId,
            successorType: entityType,
            linkType,
            lagDays: lag,
          }),
        },
      );
      if (!response.ok) {
        throw new Error(await readError(response, t('dependenciesFailed')));
      }
      const payload = (await response.json()) as { schedule?: DeliveryScheduleWrite[] };
      setPredecessorKey('');
      setLagDays('0');
      await loadLinks();
      const mine = payload.schedule?.find(
        (row) => row.entityType === entityType && row.id === entityId,
      );
      onScheduled?.(mine ?? null);
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
      const payload = (await response.json()) as { schedule?: DeliveryScheduleWrite[] };
      await loadLinks();
      const mine = payload.schedule?.find(
        (row) => row.entityType === entityType && row.id === entityId,
      );
      onScheduled?.(mine ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('dependenciesFailed'));
    } finally {
      setPending(false);
    }
  }

  function linkLine(link: DependencyLink, side: 'predecessor' | 'successor') {
    const item = side === 'predecessor' ? link.predecessor : link.successor;
    const name = item.humanKey ? `${item.humanKey} · ${item.title}` : item.title;
    const lag =
      link.lagDays === 0
        ? ''
        : ` ${link.lagDays > 0 ? '+' : ''}${link.lagDays}${t('lagSuffix')}`;
    return `${name} · ${t(`linkType.${link.linkType}`)}${lag}`;
  }

  return (
    <div className="grid gap-4">
      <p className="m-0 text-sm text-ink-muted">{t('dependenciesHint')}</p>
      {error ? <ErrorText>{error}</ErrorText> : null}
      <section className="grid gap-2">
        <h3 className="m-0 text-sm font-semibold">{t('predecessors')}</h3>
        {predecessors.length === 0 ? (
          <p className="m-0 text-sm text-ink-muted">{t('noPredecessors')}</p>
        ) : (
          <ul className="m-0 grid list-none gap-2 p-0">
            {predecessors.map((link) => (
              <li key={link.id} className="kh-ops-inset flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm">{linkLine(link, 'predecessor')}</span>
                {canEdit ? (
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={pending}
                    onClick={() => void removeLink(link.id)}
                  >
                    {t('removeDependency')}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {canEdit ? (
          <div className="kh-ops-form-grid">
            <Field className="kh-ops-field-span" label={t('predecessor')}>
              <Select
                value={predecessorKey}
                onChange={(event) => setPredecessorKey(event.target.value)}
                disabled={pending}
              >
                <option value="">{t('selectPredecessor')}</option>
                {options.map((option) => (
                  <option key={`${option.entityType}:${option.id}`} value={`${option.entityType}:${option.id}`}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('linkTypeLabel')}>
              <Select
                value={linkType}
                onChange={(event) => setLinkType(event.target.value as LinkType)}
                disabled={pending}
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
                value={lagDays}
                onChange={(event) => setLagDays(event.target.value)}
                disabled={pending}
              />
            </Field>
            <div className="flex items-end">
              <Button
                type="button"
                disabled={pending || !predecessorKey}
                onClick={() => void addPredecessor()}
              >
                {t('addPredecessor')}
              </Button>
            </div>
          </div>
        ) : null}
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
                {linkLine(link, 'successor')}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
