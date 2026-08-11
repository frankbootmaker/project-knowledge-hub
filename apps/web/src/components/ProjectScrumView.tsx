'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Badge,
  Button,
  Field,
  Input,
  Modal,
  Select,
  Textarea,
} from './ui';
import { ProjectDeliveryBoard, type BoardTask } from './ProjectDeliveryBoard';
import {
  BurndownLegendHelp,
  SprintPointBurndownChart,
  type PointBurndownRow,
} from './SprintPointBurndownChart';

export type ScrumSprint = {
  id: string;
  name: string;
  goal: string | null;
  status: string;
  startDate: string | null;
  endDate: string | null;
  capacityPoints: number | null;
  committedPoints: number;
  donePoints: number;
  humanKey?: string | null;
};

type PlanRow = {
  taskId: string;
  selected: boolean;
  storyPoints: string;
};

type Props = {
  projectId: string;
  projectName: string;
  workspaceId: string;
  canMutate: boolean;
  definitionOfDone?: string | null;
  tasks: BoardTask[];
  onTaskStatusChange: (taskId: string, status: string) => void;
  onOpenTask: (taskId: string) => void;
  onAssignToSprint: (taskId: string, sprintId: string | null) => Promise<void>;
  onRefresh: () => void;
};

export function ProjectScrumView({
  projectId,
  projectName,
  workspaceId,
  canMutate,
  definitionOfDone = null,
  tasks,
  onTaskStatusChange,
  onOpenTask,
  onAssignToSprint,
  onRefresh,
}: Props) {
  const t = useTranslations('delivery');
  const tCommon = useTranslations('common');
  const [sprints, setSprints] = useState<ScrumSprint[]>([]);
  const [selectedSprintId, setSelectedSprintId] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [capacity, setCapacity] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [planRows, setPlanRows] = useState<PlanRow[]>([]);
  const [wizardActivate, setWizardActivate] = useState(false);
  const [burndown, setBurndown] = useState<{
    committedPoints: number;
    startDate: string | null;
    endDate: string | null;
    points: PointBurndownRow[];
  } | null>(null);

  const loadSprints = useCallback(async () => {
    const response = await fetch(`/api/v1/projects/${projectId}/sprints`);
    if (!response.ok) {
      setError(t('scrumLoadFailed'));
      return;
    }
    const payload = (await response.json()) as { sprints: ScrumSprint[] };
    setSprints(payload.sprints);
    setSelectedSprintId((current) => {
      if (current && payload.sprints.some((sprint) => sprint.id === current)) {
        return current;
      }
      const active = payload.sprints.find((sprint) => sprint.status === 'active');
      return active?.id ?? payload.sprints[0]?.id ?? '';
    });
  }, [projectId, t]);

  useEffect(() => {
    void loadSprints();
  }, [loadSprints]);

  const selected = sprints.find((sprint) => sprint.id === selectedSprintId) ?? null;
  const sprintTasks = useMemo(
    () =>
      tasks.filter((task) =>
        selectedSprintId ? task.sprintId === selectedSprintId : false,
      ),
    [tasks, selectedSprintId],
  );
  const backlogTasks = useMemo(
    () =>
      tasks.filter((task) => !task.sprintId && task.status !== 'cancelled'),
    [tasks],
  );

  useEffect(() => {
    if (!selectedSprintId) {
      setBurndown(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const response = await fetch(
        `/api/v1/project-sprints/${selectedSprintId}/burndown`,
      );
      if (!response.ok || cancelled) return;
      const payload = (await response.json()) as {
        burndown: {
          committedPoints: number;
          startDate: string | null;
          endDate: string | null;
          points: PointBurndownRow[];
        };
      };
      if (!cancelled) setBurndown(payload.burndown);
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedSprintId, sprintTasks]);

  function openWizard() {
    setPlanRows(
      backlogTasks.map((task) => ({
        taskId: task.id,
        selected: false,
        storyPoints:
          task.storyPoints != null && task.storyPoints > 0
            ? String(task.storyPoints)
            : '',
      })),
    );
    setCapacity(
      selected?.capacityPoints != null ? String(selected.capacityPoints) : '',
    );
    setWizardActivate(selected?.status === 'planned');
    setWizardOpen(true);
    setError(null);
  }

  async function createSprint() {
    if (!name.trim()) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/projects/${projectId}/sprints`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          goal: goal.trim() || null,
          capacityPoints: capacity ? Number(capacity) : null,
          startDate: startDate || null,
          endDate: endDate || null,
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          message?: string;
        } | null;
        throw new Error(payload?.message ?? t('scrumCreateFailed'));
      }
      const created = (await response.json()) as { sprint: ScrumSprint };
      setCreateOpen(false);
      setName('');
      setGoal('');
      setCapacity('');
      setStartDate('');
      setEndDate('');
      await loadSprints();
      setSelectedSprintId(created.sprint.id);
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('scrumCreateFailed'));
    } finally {
      setPending(false);
    }
  }

  async function submitWizard() {
    if (!selected) return;
    setPending(true);
    setError(null);
    try {
      const selectedRows = planRows.filter((row) => row.selected);
      for (const row of selectedRows) {
        const points = row.storyPoints ? Number(row.storyPoints) : null;
        const response = await fetch(`/api/v1/project-tasks/${row.taskId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sprintId: selected.id,
            storyPoints:
              points != null && Number.isFinite(points) ? points : null,
          }),
        });
        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as {
            message?: string;
          } | null;
          throw new Error(payload?.message ?? t('failedUpdateTask'));
        }
      }

      const capacityPoints = capacity ? Number(capacity) : null;
      const sprintPatch: Record<string, unknown> = {
        capacityPoints:
          capacityPoints != null && Number.isFinite(capacityPoints)
            ? capacityPoints
            : null,
      };
      if (wizardActivate && selected.status === 'planned') {
        sprintPatch.status = 'active';
      }
      const sprintResponse = await fetch(
        `/api/v1/project-sprints/${selected.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(sprintPatch),
        },
      );
      if (!sprintResponse.ok) {
        const payload = (await sprintResponse.json().catch(() => null)) as {
          message?: string;
        } | null;
        throw new Error(payload?.message ?? t('scrumUpdateFailed'));
      }

      setWizardOpen(false);
      await loadSprints();
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('scrumUpdateFailed'));
    } finally {
      setPending(false);
    }
  }

  async function createCeremony(
    recordType: 'sprint_retrospective' | 'sprint_review',
  ) {
    if (!selected) return;
    setPending(true);
    setError(null);
    try {
      const title =
        recordType === 'sprint_retrospective'
          ? `Retrospective — ${selected.name}`
          : `Sprint review — ${selected.name}`;
      const createResponse = await fetch('/api/v1/knowledge-records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId,
          projectId,
          title,
          recordType,
          contentMarkdown: `# ${title}\n\n`,
          lifecycleStatus: 'draft',
        }),
      });
      if (!createResponse.ok) {
        const payload = (await createResponse.json().catch(() => null)) as {
          message?: string;
        } | null;
        throw new Error(payload?.message ?? t('scrumCeremonyFailed'));
      }
      const created = (await createResponse.json()) as {
        knowledgeRecord: { id: string };
      };
      const linkResponse = await fetch(
        `/api/v1/knowledge-records/${created.knowledgeRecord.id}/delivery-links`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            links: [{ entityType: 'sprint', entityId: selected.id }],
          }),
        },
      );
      if (!linkResponse.ok) {
        const payload = (await linkResponse.json().catch(() => null)) as {
          message?: string;
        } | null;
        throw new Error(payload?.message ?? t('scrumCeremonyFailed'));
      }
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('scrumCeremonyFailed'));
    } finally {
      setPending(false);
    }
  }

  async function setSprintStatus(status: string) {
    if (!selected) return;
    setPending(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { status };
      if (status === 'completed' || status === 'cancelled') {
        body.unfinishedDestination = 'backlog';
      }
      const response = await fetch(`/api/v1/project-sprints/${selected.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          message?: string;
        } | null;
        throw new Error(payload?.message ?? t('scrumUpdateFailed'));
      }
      await loadSprints();
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('scrumUpdateFailed'));
    } finally {
      setPending(false);
    }
  }

  const velocity = useMemo(() => {
    const completed = sprints.filter((sprint) => sprint.status === 'completed');
    if (completed.length === 0) return null;
    const recent = completed.slice(-5);
    const avg =
      recent.reduce((sum, sprint) => sum + sprint.donePoints, 0) / recent.length;
    return Math.round(avg * 10) / 10;
  }, [sprints]);

  const plannedPoints = planRows
    .filter((row) => row.selected)
    .reduce((sum, row) => sum + (Number(row.storyPoints) || 0), 0);

  const capacityLabel = selected
    ? `${selected.committedPoints}${
        selected.capacityPoints != null ? ` / ${selected.capacityPoints}` : ''
      } pts · ${selected.donePoints} done`
    : '';

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t('scrumSprint')}>
          <Select
            value={selectedSprintId}
            onChange={(event) => setSelectedSprintId(event.target.value)}
          >
            {sprints.length === 0 ? (
              <option value="">{t('scrumNoSprints')}</option>
            ) : (
              sprints.map((sprint) => (
                <option key={sprint.id} value={sprint.id}>
                  {(sprint.humanKey ? `${sprint.humanKey} · ` : '') + sprint.name}{' '}
                  ({sprint.status})
                </option>
              ))
            )}
          </Select>
        </Field>
        {canMutate ? (
          <Button type="button" variant="secondary" onClick={() => setCreateOpen(true)}>
            {t('scrumNewSprint')}
          </Button>
        ) : null}
        {canMutate && selected && selected.status !== 'completed' ? (
          <Button type="button" disabled={pending} onClick={openWizard}>
            {t('scrumPlanWizard')}
          </Button>
        ) : null}
        {canMutate && selected?.status === 'planned' ? (
          <Button
            type="button"
            disabled={pending}
            onClick={() => void setSprintStatus('active')}
          >
            {t('scrumActivate')}
          </Button>
        ) : null}
        {canMutate && selected?.status === 'active' ? (
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={() => void setSprintStatus('completed')}
          >
            {t('scrumClose')}
          </Button>
        ) : null}
        {canMutate && selected ? (
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={() => void createCeremony('sprint_retrospective')}
          >
            {t('scrumCreateRetro')}
          </Button>
        ) : null}
        {canMutate && selected ? (
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={() => void createCeremony('sprint_review')}
          >
            {t('scrumCreateReview')}
          </Button>
        ) : null}
      </div>

      {selected ? (
        <div className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
          {selected.humanKey ? <Badge tone="brand">{selected.humanKey}</Badge> : null}
          <span>{capacityLabel}</span>
          {velocity != null ? (
            <span>· {t('scrumVelocity', { value: velocity })}</span>
          ) : null}
          {selected.goal ? <span>· {selected.goal}</span> : null}
          {selected.startDate || selected.endDate ? (
            <span>
              · {[selected.startDate, selected.endDate].filter(Boolean).join(' → ')}
            </span>
          ) : null}
        </div>
      ) : null}

      {definitionOfDone?.trim() ? (
        <div className="rounded-md border border-line px-3 py-2 text-sm">
          <p className="m-0 mb-1 text-xs font-medium uppercase tracking-wide text-ink-muted">
            {t('scrumDoD')}
          </p>
          <pre className="m-0 whitespace-pre-wrap font-sans text-ink">
            {definitionOfDone}
          </pre>
        </div>
      ) : null}

      {selected && burndown ? (
        <div className="rounded-md border border-line p-3">
          <div className="mb-2 flex items-start justify-between gap-3">
            <p className="m-0 text-sm font-semibold">{t('scrumBurndown')}</p>
            <BurndownLegendHelp />
          </div>
          <SprintPointBurndownChart
            committedPoints={burndown.committedPoints}
            startDate={burndown.startDate}
            endDate={burndown.endDate}
            points={burndown.points}
          />
        </div>
      ) : null}

      {error ? <p className="text-sm text-danger">{error}</p> : null}

      {createOpen ? (
        <div className="grid gap-3 rounded-lg border border-line p-4">
          <Field label={tCommon('name')}>
            <Input value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field label={t('scrumGoal')}>
            <Textarea
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
              rows={2}
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={t('scrumCapacity')}>
              <Input
                type="number"
                min={0}
                value={capacity}
                onChange={(event) => setCapacity(event.target.value)}
              />
            </Field>
            <Field label={t('startDate')}>
              <Input
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
              />
            </Field>
            <Field label={t('endDate')}>
              <Input
                type="date"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
              />
            </Field>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              disabled={pending || !name.trim()}
              onClick={() => void createSprint()}
            >
              {tCommon('create')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setCreateOpen(false)}
            >
              {tCommon('cancel')}
            </Button>
          </div>
        </div>
      ) : null}

      <div className="grid min-w-0 gap-4">
        <div className="min-w-0 overflow-x-auto">
          {selected ? (
            <ProjectDeliveryBoard
              projectId={projectId}
              projectName={projectName}
              tasks={sprintTasks}
              canMutate={canMutate}
              onTaskStatusChange={onTaskStatusChange}
              onManageTask={onOpenTask}
            />
          ) : (
            <p className="text-sm text-ink-muted">{t('scrumPickOrCreate')}</p>
          )}
        </div>

        <section className="grid min-w-0 gap-2 border-t border-line pt-4">
          <h3 className="m-0 text-sm font-semibold">{t('scrumBacklog')}</h3>
          {backlogTasks.length === 0 ? (
            <p className="m-0 text-sm text-ink-muted">{t('scrumBacklogEmpty')}</p>
          ) : (
            <ul className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2 lg:grid-cols-3">
              {backlogTasks.map((task) => (
                <li
                  key={task.id}
                  className="grid gap-1 rounded-md border border-line bg-panel-solid px-2 py-2 text-sm"
                >
                  <button
                    type="button"
                    className="border-0 bg-transparent p-0 text-left font-medium text-ink"
                    onClick={() => onOpenTask(task.id)}
                  >
                    {task.humanKey ? `${task.humanKey} · ` : ''}
                    {task.title}
                  </button>
                  {canMutate && selected && selected.status !== 'completed' ? (
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={pending}
                      onClick={() => void onAssignToSprint(task.id, selected.id)}
                    >
                      {t('scrumAddToSprint')}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <Modal
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        title={t('scrumPlanWizard')}
        description={t('scrumPlanWizardHint')}
      >
        <div className="grid gap-4">
          {definitionOfDone?.trim() ? (
            <div className="rounded-md border border-line px-3 py-2 text-sm">
              <p className="m-0 mb-1 text-xs font-medium uppercase tracking-wide text-ink-muted">
                {t('scrumDoD')}
              </p>
              <pre className="m-0 whitespace-pre-wrap font-sans text-ink">
                {definitionOfDone}
              </pre>
            </div>
          ) : null}

          <Field label={t('scrumCapacity')}>
            <Input
              type="number"
              min={0}
              value={capacity}
              onChange={(event) => setCapacity(event.target.value)}
            />
          </Field>

          <div className="grid gap-2">
            <p className="m-0 text-sm font-medium">{t('scrumPlanSelectBacklog')}</p>
            {planRows.length === 0 ? (
              <p className="m-0 text-sm text-ink-muted">{t('scrumBacklogEmpty')}</p>
            ) : (
              planRows.map((row) => {
                const task = backlogTasks.find((item) => item.id === row.taskId);
                if (!task) return null;
                return (
                  <label
                    key={row.taskId}
                    className="grid grid-cols-[auto_1fr_5rem] items-center gap-2 rounded-md border border-line px-2 py-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={row.selected}
                      onChange={(event) =>
                        setPlanRows((current) =>
                          current.map((item) =>
                            item.taskId === row.taskId
                              ? { ...item, selected: event.target.checked }
                              : item,
                          ),
                        )
                      }
                    />
                    <span>
                      {task.humanKey ? `${task.humanKey} · ` : ''}
                      {task.title}
                    </span>
                    <Input
                      type="number"
                      min={0}
                      placeholder="pts"
                      value={row.storyPoints}
                      onChange={(event) =>
                        setPlanRows((current) =>
                          current.map((item) =>
                            item.taskId === row.taskId
                              ? { ...item, storyPoints: event.target.value }
                              : item,
                          ),
                        )
                      }
                    />
                  </label>
                );
              })
            )}
          </div>

          <p className="m-0 text-sm text-ink-muted">
            {t('scrumPlanCommitted', { points: plannedPoints })}
            {capacity
              ? ` · ${t('scrumCapacity')}: ${capacity}`
              : ''}
          </p>

          {selected?.status === 'planned' ? (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={wizardActivate}
                onChange={(event) => setWizardActivate(event.target.checked)}
              />
              {t('scrumPlanActivate')}
            </label>
          ) : null}

          {error ? <p className="m-0 text-sm text-danger">{error}</p> : null}

          <div className="flex gap-2">
            <Button
              type="button"
              disabled={pending || !selected}
              onClick={() => void submitWizard()}
            >
              {t('scrumPlanApply')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setWizardOpen(false)}
            >
              {tCommon('cancel')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
