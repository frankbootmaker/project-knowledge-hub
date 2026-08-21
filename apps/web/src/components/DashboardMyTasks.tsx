'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Badge, Input } from './ui';
import { cn } from '../lib/cn';
import {
  deliveryScheduleSurfaceClass,
  deliveryScheduleTone,
  todayYmd,
} from '../lib/delivery-schedule';
import type { DashboardAssignedTask } from '../lib/dashboard';

const RACI_LABEL: Record<DashboardAssignedTask['myRole'], string> = {
  R: 'raciResponsible',
  A: 'raciAccountable',
  C: 'raciConsulted',
  I: 'raciInformed',
};

function taskHref(task: DashboardAssignedTask): string {
  return `/workspaces/${task.workspaceSlug}/projects/${task.projectSlug}?task=${encodeURIComponent(task.id)}#project-delivery`;
}

function sortByDue(a: DashboardAssignedTask, b: DashboardAssignedTask): number {
  if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
  if (a.dueDate) return -1;
  if (b.dueDate) return 1;
  return a.title.localeCompare(b.title);
}

export function DashboardMyTasks({
  tasks,
}: {
  tasks: DashboardAssignedTask[];
}) {
  const t = useTranslations('dashboard');
  const tDelivery = useTranslations('delivery');
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rows = needle
      ? tasks.filter((task) =>
          [
            task.title,
            task.projectName,
            task.workspaceName,
            task.status,
            task.myRole,
            task.dueDate ?? '',
            task.currentOwner?.displayName ?? '',
          ]
            .join(' ')
            .toLowerCase()
            .includes(needle),
        )
      : tasks;
    return [...rows].sort(sortByDue);
  }, [tasks, query]);

  return (
    <section className="kh-ops-panel">
      <div className="kh-ops-panel-head">
        <h2 className="kh-ops-panel-title">{t('queueTitle')}</h2>
        <span className="kh-ops-panel-meta">{t('queueMeta')}</span>
      </div>
      <div className="kh-ops-toolbar mb-0 border-0 border-b border-line">
        <label className="flex min-w-[220px] flex-1 items-center gap-2">
          <span className="sr-only">{t('myTasksSearch')}</span>
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('myTasksSearch')}
            className="h-10 min-h-10 py-1.5 text-xs"
          />
        </label>
      </div>
      {filtered.length === 0 ? (
        <p className="kh-ops-empty">{t('myTasksEmpty')}</p>
      ) : (
        <div className="kh-ops-table-wrap">
          <table className="kh-ops-data-table">
            <thead>
              <tr>
                <th>{t('colWorkItem')}</th>
                <th>{t('colProject')}</th>
                <th>{t('colRole')}</th>
                <th>{t('colDue')}</th>
                <th>{t('colState')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((task) => {
                const scheduleTone = deliveryScheduleTone({
                  status: task.status,
                  date: task.dueDate,
                  today: todayYmd(),
                });
                return (
                  <tr key={task.id}>
                    <td className="kh-ops-primary-cell">
                      <Link href={taskHref(task)} className="no-underline">
                        {task.title}
                      </Link>
                    </td>
                    <td>
                      <span className="text-ink-muted">
                        {task.workspaceName} / {task.projectName}
                      </span>
                    </td>
                    <td>
                      <span className="kh-ops-type-chip">{t(RACI_LABEL[task.myRole])}</span>
                    </td>
                    <td>
                      {task.dueDate ? (
                        <span
                          className={cn(
                            scheduleTone === 'overdue' && 'font-semibold text-danger',
                          )}
                        >
                          {task.dueDate}
                        </span>
                      ) : (
                        <span className="text-ink-muted">—</span>
                      )}
                    </td>
                    <td>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge>{tDelivery(`taskStatus.${task.status}`)}</Badge>
                        <span
                          className={cn(
                            'inline-flex items-center border px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wide uppercase',
                            deliveryScheduleSurfaceClass(scheduleTone),
                          )}
                        >
                          {tDelivery(`scheduleToneShort.${scheduleTone}`)}
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
