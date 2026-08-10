'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Badge } from './ui';
import { cn } from '../lib/cn';

export type OrgChartStakeholder = {
  id: string;
  kind: 'person' | 'ai_assistant';
  userId: string | null;
  displayName: string;
  fullName: string | null;
  email: string | null;
  projectRole: string | null;
  jobTitle: string | null;
  notes?: string | null;
  reportsToUserId: string | null;
  raciRoles: string[];
  sources: string[];
  systemSlug?: string | null;
  systemStatus?: string | null;
};

type TreeNode = {
  stakeholder: OrgChartStakeholder;
  children: TreeNode[];
};

function buildForest(stakeholders: OrgChartStakeholder[]): {
  roots: TreeNode[];
  ungrouped: OrgChartStakeholder[];
} {
  const byId = new Map(stakeholders.map((row) => [row.id, row]));
  const childIds = new Set<string>();
  const childrenOf = new Map<string, string[]>();

  for (const row of stakeholders) {
    const managerUserId = row.reportsToUserId;
    if (!managerUserId || managerUserId === row.userId) continue;
    // Manager key is always a person userId (also their stakeholder id).
    if (!byId.has(managerUserId)) continue;
    childIds.add(row.id);
    const list = childrenOf.get(managerUserId) ?? [];
    list.push(row.id);
    childrenOf.set(managerUserId, list);
  }

  function toNode(nodeId: string, trail: Set<string>): TreeNode | null {
    if (trail.has(nodeId)) return null;
    const stakeholder = byId.get(nodeId);
    if (!stakeholder) return null;
    const nextTrail = new Set(trail);
    nextTrail.add(nodeId);
    const children = (childrenOf.get(nodeId) ?? [])
      .map((childId) => toNode(childId, nextTrail))
      .filter((node): node is TreeNode => node != null);
    return { stakeholder, children };
  }

  const roots: TreeNode[] = [];
  for (const row of stakeholders) {
    if (childIds.has(row.id)) continue;
    if (!row.reportsToUserId || !byId.has(row.reportsToUserId)) {
      const hasChildren = (childrenOf.get(row.id) ?? []).length > 0;
      if (hasChildren) {
        const node = toNode(row.id, new Set());
        if (node) roots.push(node);
      }
    }
  }

  const inTree = new Set<string>();
  function mark(node: TreeNode) {
    inTree.add(node.stakeholder.id);
    for (const child of node.children) mark(child);
  }
  for (const root of roots) mark(root);

  const ungrouped = stakeholders.filter((row) => !inTree.has(row.id));
  return { roots, ungrouped };
}

function StakeholderCard({
  stakeholder,
}: {
  stakeholder: OrgChartStakeholder;
}) {
  const t = useTranslations('stakeholders');
  const isAi = stakeholder.kind === 'ai_assistant';

  return (
    <article
      className={cn(
        'min-w-[12rem] max-w-[16rem] rounded-lg border p-3 shadow-sm',
        isAi
          ? 'border-brand/30 bg-brand-soft/40'
          : 'border-line bg-panel-solid',
      )}
    >
      <p className="m-0 text-sm font-semibold text-ink">{stakeholder.displayName}</p>
      {stakeholder.fullName && stakeholder.fullName !== stakeholder.displayName ? (
        <p className="mt-0.5 mb-0 text-xs text-ink-muted">{stakeholder.fullName}</p>
      ) : null}
      {stakeholder.email ? (
        <a
          href={`mailto:${stakeholder.email}`}
          className="mt-1 block truncate text-xs text-brand no-underline hover:underline"
        >
          {stakeholder.email}
        </a>
      ) : null}
      {!isAi && stakeholder.jobTitle ? (
        <p className="mt-1 mb-0 text-xs text-ink-muted">{stakeholder.jobTitle}</p>
      ) : null}
      {isAi && stakeholder.notes ? (
        <p className="mt-1 mb-0 line-clamp-2 text-xs text-ink-muted">{stakeholder.notes}</p>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-1">
        {isAi ? <Badge tone="brand">{t('kindAiAssistant')}</Badge> : null}
        {stakeholder.projectRole && !isAi ? (
          <Badge tone="brand">{t(`projectRole.${stakeholder.projectRole}`)}</Badge>
        ) : null}
        {stakeholder.raciRoles.map((role) => (
          <Badge key={role}>{role}</Badge>
        ))}
      </div>
    </article>
  );
}

function TreeBranch({ node, depth }: { node: TreeNode; depth: number }) {
  return (
    <li className="list-none">
      <div
        className={cn(
          'flex flex-col items-stretch gap-3 md:items-center',
          depth > 0 && 'md:pt-2',
        )}
      >
        <div className={cn(depth > 0 && 'border-l border-line pl-4 md:border-l-0 md:pl-0')}>
          <StakeholderCard stakeholder={node.stakeholder} />
        </div>
        {node.children.length > 0 ? (
          <ul
            className={cn(
              'm-0 flex list-none flex-col gap-3 p-0',
              'md:flex-row md:flex-wrap md:justify-center md:gap-4',
            )}
          >
            {node.children.map((child) => (
              <TreeBranch key={child.stakeholder.id} node={child} depth={depth + 1} />
            ))}
          </ul>
        ) : null}
      </div>
    </li>
  );
}

export function ProjectStakeholdersOrgChart({
  stakeholders,
}: {
  stakeholders: OrgChartStakeholder[];
}) {
  const t = useTranslations('stakeholders');
  const { roots, ungrouped } = useMemo(
    () => buildForest(stakeholders),
    [stakeholders],
  );

  if (stakeholders.length === 0) {
    return (
      <div className="rounded-lg border border-line px-4 py-10 text-center text-sm text-ink-muted">
        {t('empty')}
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      <p className="m-0 text-xs text-ink-muted">{t('orgChartHint')}</p>

      {roots.length > 0 ? (
        <div className="overflow-x-auto pb-2">
          <ul className="m-0 flex list-none flex-col gap-6 p-0 md:items-center">
            {roots.map((root) => (
              <TreeBranch key={root.stakeholder.id} node={root} depth={0} />
            ))}
          </ul>
        </div>
      ) : (
        <p className="m-0 text-sm text-ink-muted">{t('orgChartNoHierarchy')}</p>
      )}

      {ungrouped.length > 0 ? (
        <div className="grid gap-3">
          <h3 className="m-0 text-sm font-semibold">{t('orgChartUngrouped')}</h3>
          <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
            {ungrouped.map((row) => (
              <li key={row.id}>
                <StakeholderCard stakeholder={row} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
