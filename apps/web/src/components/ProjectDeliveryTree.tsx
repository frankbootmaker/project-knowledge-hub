'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from './ui';
import { toHours } from '../lib/task-costing';

type TreeEpic = {
  id: string;
  title: string;
  status: string;
  sortOrder: number;
  humanKey?: string | null;
};

type TreeStory = {
  id: string;
  epicId: string;
  title: string;
  status: string;
  sortOrder: number;
  humanKey?: string | null;
};

type TreeTask = {
  id: string;
  title: string;
  status: string;
  dueDate: string | null;
  userStoryId: string | null;
  currentOwner: {
    displayName: string;
    avatarUrl?: string | null;
  } | null;
  humanKey?: string | null;
  forecastHours?: string | number | null;
  actualHours?: string | number | null;
  storyPoints?: number | null;
  sprintLabel?: string | null;
};

function TreeBranch({
  open,
  onToggle,
  label,
  sub,
  meta,
  children,
  depth,
  actions,
}: {
  open: boolean;
  onToggle?: () => void;
  label: ReactNode;
  sub?: ReactNode;
  meta?: ReactNode;
  children?: ReactNode;
  depth: number;
  actions?: ReactNode;
}) {
  const hasChildren = Boolean(children);
  return (
    <li className="list-none">
      <div className="kh-ops-delivery-tree-row">
        <div className="kh-ops-tree-main" style={{ ['--level' as string]: depth }}>
          {hasChildren && onToggle ? (
            <button
              type="button"
              className="kh-ops-tree-toggle"
              aria-expanded={open}
              onClick={onToggle}
            >
              {open ? '⌄' : '›'}
            </button>
          ) : (
            <span className="kh-ops-tree-spacer" aria-hidden />
          )}
          <div className="kh-ops-tree-title">
            <strong>{label}</strong>
            {sub ? <small>{sub}</small> : null}
          </div>
        </div>
        <div className="kh-ops-tree-meta">
          {meta}
          {actions}
        </div>
      </div>
      {hasChildren && open ? (
        <ul className="m-0 grid list-none p-0">{children}</ul>
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

  function metaBits(input: {
    statusLabel: string;
    owner?: string | null;
    sprint?: string | null;
    hours?: number | null;
    points?: number | null;
  }) {
    return (
      <>
        <span>{input.statusLabel}</span>
        <span>{input.owner ?? '—'}</span>
        <span>{input.sprint ?? '—'}</span>
        <span>{input.hours == null ? '—' : `${input.hours}h`}</span>
        <span>{input.points == null ? '—' : `${input.points}pt`}</span>
      </>
    );
  }

  function renderTask(task: TreeTask, depth: number) {
    return (
      <TreeBranch
        key={task.id}
        open
        depth={depth}
        label={task.title}
        sub={task.humanKey ?? t('kindTask')}
        meta={metaBits({
          statusLabel: t(`taskStatus.${task.status}`),
          owner: task.currentOwner?.displayName ?? null,
          sprint: task.sprintLabel ?? null,
          hours: toHours(task.forecastHours),
          points: task.storyPoints ?? null,
        })}
        actions={
          onManageTask ? (
            <Button
              type="button"
              variant="secondary"
              className="h-8 min-h-8 px-2 text-xs"
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
        label={story.title}
        sub={story.humanKey ?? t('kindStory')}
        meta={metaBits({
          statusLabel: t(`milestoneStatus.${story.status}`),
        })}
        actions={
          onManageStory ? (
            <Button
              type="button"
              variant="secondary"
              className="h-8 min-h-8 px-2 text-xs"
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
            <li className="kh-ops-delivery-tree-row list-none text-sm text-ink-muted">
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
    return (
      <section className="kh-ops-panel">
        <div className="kh-ops-empty-state">
          <div className="kh-ops-empty-mark">00</div>
          <h3>{t('emptyTitle')}</h3>
          <p>{t('treeEmpty')}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="kh-ops-panel overflow-x-auto">
      <div className="kh-ops-delivery-tree">
        <div className="kh-ops-delivery-tree-head">
          <span>{t('treeBreakdown')}</span>
          <span>{t('treeMetaHead')}</span>
        </div>
        <ul className="m-0 grid list-none p-0">
          {tree.sortedEpics.map((epic) => {
            const epicStories = tree.storiesByEpic.get(epic.id) ?? [];
            const nodeId = `epic:${epic.id}`;
            return (
              <TreeBranch
                key={epic.id}
                open={isOpen(nodeId)}
                onToggle={() => toggle(nodeId)}
                depth={0}
                label={epic.title}
                sub={epic.humanKey ?? t('kindEpic')}
                meta={metaBits({
                  statusLabel: t(`milestoneStatus.${epic.status}`),
                })}
                actions={
                  onManageEpic ? (
                    <Button
                      type="button"
                      variant="secondary"
                      className="h-8 min-h-8 px-2 text-xs"
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
                    <li className="kh-ops-delivery-tree-row list-none text-sm text-ink-muted">
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
              label={t('treeUngroupedStories')}
              sub={t('kindStory')}
            >
              {tree.orphanStories.map((story) => renderStory(story, 1))}
            </TreeBranch>
          ) : null}

          {tree.ungroupedTasks.length > 0 ? (
            <TreeBranch
              open={isOpen('ungrouped-tasks')}
              onToggle={() => toggle('ungrouped-tasks')}
              depth={0}
              label={t('treeUngroupedTasks')}
              sub={t('kindTask')}
            >
              {tree.ungroupedTasks.map((task) => renderTask(task, 1))}
            </TreeBranch>
          ) : null}
        </ul>
      </div>
    </section>
  );
}
