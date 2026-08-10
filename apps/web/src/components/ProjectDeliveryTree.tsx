'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Badge, Button } from './ui';
import { cn } from '../lib/cn';
import {
  deliveryScheduleSurfaceClass,
  deliveryScheduleTone,
  todayYmd,
} from '../lib/delivery-schedule';

type TreeEpic = {
  id: string;
  title: string;
  status: string;
  sortOrder: number;
};

type TreeStory = {
  id: string;
  epicId: string;
  title: string;
  status: string;
  sortOrder: number;
};

type TreeTask = {
  id: string;
  title: string;
  status: string;
  dueDate: string | null;
  userStoryId: string | null;
  currentOwner: { displayName: string } | null;
};

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden
      className={cn(
        'size-3.5 shrink-0 text-ink-muted transition-transform',
        open && 'rotate-90',
      )}
      fill="none"
    >
      <path
        d="M7 5l5 5-5 5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TreeBranch({
  open,
  onToggle,
  label,
  badge,
  statusLabel,
  meta,
  children,
  depth,
  actions,
}: {
  open: boolean;
  onToggle?: () => void;
  label: ReactNode;
  badge?: string;
  statusLabel?: string;
  meta?: ReactNode;
  children?: ReactNode;
  depth: number;
  actions?: ReactNode;
}) {
  const hasChildren = Boolean(children);
  return (
    <li className="list-none">
      <div
        className={cn(
          'flex flex-wrap items-start gap-2 rounded-md border border-line bg-panel-solid px-3 py-2',
          depth === 0 && 'border-brand/25',
        )}
        style={{ marginLeft: depth * 16 }}
      >
        {hasChildren && onToggle ? (
          <button
            type="button"
            className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded border-0 bg-transparent p-0 text-ink"
            aria-expanded={open}
            onClick={onToggle}
          >
            <Chevron open={open} />
          </button>
        ) : (
          <span className="mt-0.5 inline-flex size-6 shrink-0" aria-hidden />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {badge ? <Badge tone="brand">{badge}</Badge> : null}
            <span className="font-semibold text-ink">{label}</span>
            {statusLabel ? <Badge>{statusLabel}</Badge> : null}
          </div>
          {meta ? (
            <div className="mt-1 text-xs text-ink-muted">{meta}</div>
          ) : null}
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
      {hasChildren && open ? (
        <ul className="m-0 mt-2 grid list-none gap-2 p-0">{children}</ul>
      ) : null}
    </li>
  );
}

export function ProjectDeliveryTree({
  epics,
  stories,
  tasks,
  onManageTask,
  onManageEpic,
  onManageStory,
}: {
  epics: TreeEpic[];
  stories: TreeStory[];
  tasks: TreeTask[];
  onManageTask?: (taskId: string) => void;
  onManageEpic?: (epicId: string) => void;
  onManageStory?: (storyId: string) => void;
}) {
  const t = useTranslations('delivery');
  const today = todayYmd();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  function isOpen(id: string) {
    return collapsed[id] !== true;
  }

  function toggle(id: string) {
    setCollapsed((current) => ({ ...current, [id]: !current[id] }));
  }

  const tree = useMemo(() => {
    const storiesByEpic = new Map<string, TreeStory[]>();
    const orphanStories: TreeStory[] = [];
    const epicIds = new Set(epics.map((epic) => epic.id));

    for (const story of [...stories].sort(
      (a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title),
    )) {
      if (!epicIds.has(story.epicId)) {
        orphanStories.push(story);
        continue;
      }
      const list = storiesByEpic.get(story.epicId) ?? [];
      list.push(story);
      storiesByEpic.set(story.epicId, list);
    }

    const tasksByStory = new Map<string, TreeTask[]>();
    const ungroupedTasks: TreeTask[] = [];
    for (const task of [...tasks].sort((a, b) => a.title.localeCompare(b.title))) {
      if (!task.userStoryId) {
        ungroupedTasks.push(task);
        continue;
      }
      const list = tasksByStory.get(task.userStoryId) ?? [];
      list.push(task);
      tasksByStory.set(task.userStoryId, list);
    }

    const sortedEpics = [...epics].sort(
      (a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title),
    );

    return { storiesByEpic, orphanStories, tasksByStory, ungroupedTasks, sortedEpics };
  }, [epics, stories, tasks]);

  function renderTask(task: TreeTask, depth: number) {
    const tone = deliveryScheduleTone({
      status: task.status,
      date: task.dueDate,
      today,
    });
    return (
      <TreeBranch
        key={task.id}
        open
        depth={depth}
        badge={t('kindTask')}
        label={task.title}
        statusLabel={t(`taskStatus.${task.status}`)}
        meta={
          <div className="flex flex-wrap items-center gap-2">
            {task.dueDate ? <span>{t('dueDate')}: {task.dueDate}</span> : null}
            {task.currentOwner ? (
              <span>
                {t('ownerLabel')}: {task.currentOwner.displayName}
              </span>
            ) : null}
            <span
              className={cn(
                'inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-semibold',
                deliveryScheduleSurfaceClass(tone),
              )}
            >
              {t(`scheduleTone.${tone}`)}
            </span>
          </div>
        }
        actions={
          onManageTask ? (
            <Button
              type="button"
              variant="secondary"
              className="h-8 px-2 text-xs"
              onClick={() => onManageTask(task.id)}
            >
              {t('manage')}
            </Button>
          ) : null
        }
      />
    );
  }

  function renderStory(story: TreeStory, depth: number) {
    const storyTasks = tree.tasksByStory.get(story.id) ?? [];
    const nodeId = `story:${story.id}`;
    return (
      <TreeBranch
        key={story.id}
        open={isOpen(nodeId)}
        onToggle={() => toggle(nodeId)}
        depth={depth}
        badge={t('kindStory')}
        label={story.title}
        statusLabel={t(`milestoneStatus.${story.status}`)}
        meta={t('treeStoryCount', { count: storyTasks.length })}
        actions={
          onManageStory ? (
            <Button
              type="button"
              variant="secondary"
              className="h-8 px-2 text-xs"
              onClick={() => onManageStory(story.id)}
            >
              {t('manage')}
            </Button>
          ) : null
        }
      >
        {storyTasks.length > 0
          ? storyTasks.map((task) => renderTask(task, depth + 1))
          : (
            <li
              className="list-none text-sm text-ink-muted"
              style={{ marginLeft: (depth + 1) * 16 }}
            >
              {t('treeNoTasks')}
            </li>
          )}
      </TreeBranch>
    );
  }

  const hasAny =
    tree.sortedEpics.length > 0 ||
    tree.orphanStories.length > 0 ||
    tree.ungroupedTasks.length > 0;

  if (!hasAny) {
    return <p className="m-0 text-sm text-ink-muted">{t('treeEmpty')}</p>;
  }

  return (
    <div className="grid gap-3">
      <p className="m-0 text-xs text-ink-muted">{t('treeHint')}</p>
      <ul className="m-0 grid list-none gap-2 p-0">
        {tree.sortedEpics.map((epic) => {
          const epicStories = tree.storiesByEpic.get(epic.id) ?? [];
          const nodeId = `epic:${epic.id}`;
          return (
            <TreeBranch
              key={epic.id}
              open={isOpen(nodeId)}
              onToggle={() => toggle(nodeId)}
              depth={0}
              badge={t('kindEpic')}
              label={epic.title}
              statusLabel={t(`milestoneStatus.${epic.status}`)}
              meta={t('treeEpicCount', {
                stories: epicStories.length,
                tasks: epicStories.reduce(
                  (sum, story) => sum + (tree.tasksByStory.get(story.id)?.length ?? 0),
                  0,
                ),
              })}
              actions={
                onManageEpic ? (
                  <Button
                    type="button"
                    variant="secondary"
                    className="h-8 px-2 text-xs"
                    onClick={() => onManageEpic(epic.id)}
                  >
                    {t('manage')}
                  </Button>
                ) : null
              }
            >
              {epicStories.length > 0
                ? epicStories.map((story) => renderStory(story, 1))
                : (
                  <li
                    className="list-none text-sm text-ink-muted"
                    style={{ marginLeft: 16 }}
                  >
                    {t('treeNoStories')}
                  </li>
                )}
            </TreeBranch>
          );
        })}

        {tree.orphanStories.length > 0 ? (
          <TreeBranch
            open={isOpen('orphan-stories')}
            onToggle={() => toggle('orphan-stories')}
            depth={0}
            badge={t('kindStory')}
            label={t('treeUngroupedStories')}
          >
            {tree.orphanStories.map((story) => renderStory(story, 1))}
          </TreeBranch>
        ) : null}

        {tree.ungroupedTasks.length > 0 ? (
          <TreeBranch
            open={isOpen('ungrouped-tasks')}
            onToggle={() => toggle('ungrouped-tasks')}
            depth={0}
            badge={t('kindTask')}
            label={t('treeUngroupedTasks')}
            meta={t('treeStoryCount', { count: tree.ungroupedTasks.length })}
          >
            {tree.ungroupedTasks.map((task) => renderTask(task, 1))}
          </TreeBranch>
        ) : null}
      </ul>
    </div>
  );
}
