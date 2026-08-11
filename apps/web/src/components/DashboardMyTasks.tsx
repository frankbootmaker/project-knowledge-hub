'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import {
  CatalogueSection,
  type CatalogueListItem,
} from './CatalogueSection';
import { CollapsibleSection } from './CollapsibleSection';
import { Badge } from './ui';
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

export function DashboardMyTasks({
  tasks,
}: {
  tasks: DashboardAssignedTask[];
}) {
  const t = useTranslations('dashboard');
  const tDelivery = useTranslations('delivery');
  const tWorkspaces = useTranslations('workspaces');

  const items: CatalogueListItem[] = useMemo(
    () =>
      tasks.map((task) => {
        const href = taskHref(task);
        const raciShort = t(RACI_LABEL[task.myRole]);
        return {
          id: task.id,
          title: task.title,
          href,
          primaryBadge: tDelivery(`taskStatus.${task.status}`),
          secondaryBadge: raciShort,
          subtitle: [
            task.workspaceName,
            task.projectName,
            task.dueDate ? `${tDelivery('dueDate')}: ${task.dueDate}` : null,
            task.milestoneTitle
              ? `${tDelivery('milestoneOptional')}: ${task.milestoneTitle}`
              : null,
            task.currentOwner?.displayName
              ? `${tDelivery('ownerLabel')}: ${task.currentOwner.displayName}`
              : null,
          ]
            .filter(Boolean)
            .join(' · '),
          // Catalogue date sort uses updatedAt; map due dates so "oldest" = soonest due.
          updatedAt: task.dueDate
            ? `${task.dueDate}T12:00:00.000Z`
            : '9999-12-31T00:00:00.000Z',
          searchText: [
            task.title,
            task.description ?? '',
            task.status,
            task.myRole,
            raciShort,
            task.workspaceName,
            task.projectName,
            task.milestoneTitle ?? '',
            task.currentOwner?.displayName ?? '',
            task.dueDate ?? '',
          ]
            .join(' ')
            .toLowerCase(),
          filterValue: task.status,
          filterLabel: tDelivery(`taskStatus.${task.status}`),
        };
      }),
    [tasks, t, tDelivery],
  );

  const taskById = useMemo(() => {
    const map = new Map<string, DashboardAssignedTask>();
    for (const task of tasks) map.set(task.id, task);
    return map;
  }, [tasks]);

  return (
    <CollapsibleSection
      storageKey="dashboard:my-tasks"
      title={t('myTasks')}
      defaultOpen
    >
      <CatalogueSection
        title={t('myTasks')}
        showTitle={false}
        className="mb-0"
        items={items}
        emptyLabel={t('myTasksEmpty')}
        searchPlaceholder={t('myTasksSearch')}
        filterLabel={tDelivery('filterStatus')}
        filterAllLabel={tWorkspaces('sectionFilterAll')}
        createLabel=""
        canCreate={false}
        defaultSort="oldest"
        renderItem={(item) => {
          const task = taskById.get(item.id);
          const scheduleTone = task
            ? deliveryScheduleTone({
                status: task.status,
                date: task.dueDate,
                today: todayYmd(),
              })
            : null;

          return (
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                {item.href ? (
                  <Link href={item.href} className="font-semibold no-underline">
                    {item.title}
                  </Link>
                ) : (
                  <span className="font-semibold">{item.title}</span>
                )}
                {item.secondaryBadge ? (
                  <Badge tone="brand">{item.secondaryBadge}</Badge>
                ) : null}
                {item.primaryBadge ? <Badge>{item.primaryBadge}</Badge> : null}
                {scheduleTone ? (
                  <span
                    className={cn(
                      'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold tracking-wide',
                      deliveryScheduleSurfaceClass(scheduleTone),
                    )}
                  >
                    <span className="sm:hidden">
                      {tDelivery(`scheduleToneShort.${scheduleTone}`)}
                    </span>
                    <span className="hidden sm:inline">
                      {tDelivery(`scheduleTone.${scheduleTone}`)}
                    </span>
                  </span>
                ) : null}
              </div>
              {item.subtitle ? (
                <p className="mt-2 mb-0 text-sm text-ink-muted">{item.subtitle}</p>
              ) : null}
            </div>
          );
        }}
      />
    </CollapsibleSection>
  );
}
