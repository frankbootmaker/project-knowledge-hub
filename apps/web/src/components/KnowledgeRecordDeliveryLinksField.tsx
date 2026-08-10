'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, ErrorText, Field, useToast } from './ui';

type DeliveryEntity = {
  entityType: 'epic' | 'user_story' | 'task';
  entityId: string;
  label: string;
  group: string;
};

type LinkKey = string;

function linkKey(entityType: string, entityId: string): LinkKey {
  return `${entityType}:${entityId}`;
}

export function KnowledgeRecordDeliveryLinksField({
  recordId,
  projectId,
  canMutate,
}: {
  recordId: string;
  projectId: string;
  canMutate: boolean;
}) {
  const t = useTranslations('records');
  const tDelivery = useTranslations('delivery');
  const { pushToast } = useToast();

  const [entities, setEntities] = useState<DeliveryEntity[]>([]);
  const [selected, setSelected] = useState<Set<LinkKey>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [epicsRes, storiesRes, tasksRes, linksRes] = await Promise.all([
        fetch(`/api/v1/projects/${projectId}/epics`),
        fetch(`/api/v1/projects/${projectId}/user-stories`),
        fetch(`/api/v1/projects/${projectId}/tasks`),
        fetch(`/api/v1/knowledge-records/${recordId}/delivery-links`),
      ]);

      const epicsPayload = (await epicsRes.json().catch(() => ({}))) as {
        epics?: Array<{ id: string; title: string }>;
      };
      const storiesPayload = (await storiesRes.json().catch(() => ({}))) as {
        userStories?: Array<{ id: string; epicId: string; title: string }>;
      };
      const tasksPayload = (await tasksRes.json().catch(() => ({}))) as {
        tasks?: Array<{ id: string; title: string; userStoryTitle?: string | null }>;
      };
      const linksPayload = (await linksRes.json().catch(() => ({}))) as {
        deliveryLinks?: Array<{ entityType: string; entityId: string }>;
        error?: { message?: string };
      };

      if (!epicsRes.ok || !storiesRes.ok || !tasksRes.ok || !linksRes.ok) {
        throw new Error(
          linksPayload.error?.message || t('deliveryLinksFailedLoad'),
        );
      }

      const epicTitle = new Map(
        (epicsPayload.epics ?? []).map((epic) => [epic.id, epic.title]),
      );
      const nextEntities: DeliveryEntity[] = [
        ...(epicsPayload.epics ?? []).map((epic) => ({
          entityType: 'epic' as const,
          entityId: epic.id,
          label: epic.title,
          group: tDelivery('kindEpic'),
        })),
        ...(storiesPayload.userStories ?? []).map((story) => ({
          entityType: 'user_story' as const,
          entityId: story.id,
          label: `${epicTitle.get(story.epicId) ?? '…'} · ${story.title}`,
          group: tDelivery('kindStory'),
        })),
        ...(tasksPayload.tasks ?? []).map((task) => ({
          entityType: 'task' as const,
          entityId: task.id,
          label: task.userStoryTitle
            ? `${task.userStoryTitle} · ${task.title}`
            : task.title,
          group: tDelivery('kindTask'),
        })),
      ];
      setEntities(nextEntities);
      setSelected(
        new Set(
          (linksPayload.deliveryLinks ?? []).map((link) =>
            linkKey(link.entityType, link.entityId),
          ),
        ),
      );
      setLoaded(true);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t('deliveryLinksFailedLoad'),
      );
    }
  }, [projectId, recordId, t, tDelivery]);

  useEffect(() => {
    void load();
  }, [load]);

  const grouped = useMemo(() => {
    const map = new Map<string, DeliveryEntity[]>();
    for (const entity of entities) {
      const list = map.get(entity.group) ?? [];
      list.push(entity);
      map.set(entity.group, list);
    }
    return map;
  }, [entities]);

  function toggle(entity: DeliveryEntity) {
    const key = linkKey(entity.entityType, entity.entityId);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function save() {
    if (!canMutate) return;
    setPending(true);
    setError(null);
    try {
      const links = [...selected].map((key) => {
        const separator = key.indexOf(':');
        return {
          entityType: key.slice(0, separator) as 'epic' | 'user_story' | 'task',
          entityId: key.slice(separator + 1),
        };
      });
      const response = await fetch(
        `/api/v1/knowledge-records/${recordId}/delivery-links`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ links }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(payload.error?.message || t('deliveryLinksFailedSave'));
      }
      pushToast(t('deliveryLinksSaved'), 'success');
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t('deliveryLinksFailedSave'),
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Field label={t('deliveryLinks')} className="sm:col-span-2">
      <p className="mb-2 mt-0 text-xs text-ink-muted">{t('deliveryLinksHint')}</p>
      {error ? (
        <div className="mb-2">
          <ErrorText>{error}</ErrorText>
        </div>
      ) : null}
      {!loaded ? (
        <p className="m-0 text-sm text-ink-muted">{t('deliveryLinksLoading')}</p>
      ) : entities.length === 0 ? (
        <p className="m-0 text-sm text-ink-muted">{t('deliveryLinksEmpty')}</p>
      ) : (
        <div className="max-h-56 overflow-auto rounded-md border border-line p-2">
          {[...grouped.entries()].map(([group, rows]) => (
            <div key={group} className="mb-2 last:mb-0">
              <p className="mb-1 mt-0 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                {group}
              </p>
              <ul className="m-0 grid list-none gap-1 p-0">
                {rows.map((entity) => {
                  const key = linkKey(entity.entityType, entity.entityId);
                  return (
                    <li key={key}>
                      <label className="flex items-start gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={selected.has(key)}
                          disabled={pending || !canMutate}
                          onChange={() => toggle(entity)}
                        />
                        <span>{entity.label}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
      {canMutate ? (
        <div className="mt-2">
          <Button
            type="button"
            variant="secondary"
            disabled={pending || !loaded}
            onClick={() => void save()}
          >
            {t('deliveryLinksSave')}
          </Button>
        </div>
      ) : null}
    </Field>
  );
}
