'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { AssistantBrandMark } from './AssistantBrandMark';
import { UserAvatar } from './UserAvatar';
import { Badge } from './ui';

export type OrgChartStakeholder = {
  id: string;
  kind: 'person' | 'ai_assistant' | 'open_role';
  userId: string | null;
  displayName: string;
  fullName: string | null;
  email: string | null;
  projectRole: string | null;
  jobTitle: string | null;
  notes?: string | null;
  reportsToUserId: string | null;
  avatarUrl?: string | null;
  assistantBrand?: string | null;
  systemId?: string | null;
  rosterId?: string | null;
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
  onOpen,
  openLabel,
}: {
  stakeholder: OrgChartStakeholder;
  onOpen?: () => void;
  openLabel?: string;
}) {
  const t = useTranslations('stakeholders');
  const isAi = stakeholder.kind === 'ai_assistant';
  const isOpen = stakeholder.kind === 'open_role';

  return (
    <article
      className={onOpen ? 'kh-ops-org-card kh-ops-org-card-action' : 'kh-ops-org-card'}
      data-kind={stakeholder.kind}
      role={onOpen ? 'button' : undefined}
      tabIndex={onOpen ? 0 : undefined}
      aria-label={onOpen ? openLabel : undefined}
      onClick={onOpen}
      onKeyDown={
        onOpen
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onOpen();
              }
            }
          : undefined
      }
    >
      <div className="kh-ops-org-card-head">
        <span className="kh-ops-org-photo">
          {isAi ? (
            <AssistantBrandMark
              brand={stakeholder.assistantBrand}
              name={stakeholder.displayName}
              slug={stakeholder.systemSlug}
              size="md"
            />
          ) : isOpen && !stakeholder.avatarUrl ? (
            '?'
          ) : (
            <UserAvatar
              displayName={stakeholder.displayName}
              fullName={stakeholder.fullName}
              avatarUrl={stakeholder.avatarUrl}
              size="md"
            />
          )}
        </span>
        <div className="kh-ops-org-card-copy">
          <strong>{stakeholder.displayName}</strong>
          {stakeholder.fullName &&
          stakeholder.fullName !== stakeholder.displayName ? (
            <small>{stakeholder.fullName}</small>
          ) : null}
          {stakeholder.email ? (
            <a
              href={`mailto:${stakeholder.email}`}
              className="kh-org-email"
              onClick={(event) => event.stopPropagation()}
            >
              {stakeholder.email.split(/([.@])/).map((part, index) => (
                <span
                  key={`${part}-${index}`}
                  className={
                    part === '.' || part === '@' ? undefined : 'whitespace-nowrap'
                  }
                >
                  {part}
                </span>
              ))}
            </a>
          ) : null}
          {!isAi && stakeholder.jobTitle ? (
            <small>{stakeholder.jobTitle}</small>
          ) : null}
          {isAi && stakeholder.notes ? (
            <small className="line-clamp-2">{stakeholder.notes}</small>
          ) : null}
        </div>
      </div>
      <div className="kh-ops-org-badges">
        {isAi ? <Badge tone="brand">{t('kindAiAssistant')}</Badge> : null}
        {isOpen ? <Badge tone="brand">{t('kindOpenRole')}</Badge> : null}
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

function TreeBranch({
  node,
  onOpen,
  openLabel,
}: {
  node: TreeNode;
  onOpen?: (row: OrgChartStakeholder) => void;
  openLabel: (row: OrgChartStakeholder) => string | undefined;
}) {
  const hasChildren = node.children.length > 0;
  const label = openLabel(node.stakeholder);
  const open = onOpen && label ? () => onOpen(node.stakeholder) : undefined;

  return (
    <div className="kh-ops-org-branch">
      <StakeholderCard
        stakeholder={node.stakeholder}
        onOpen={open}
        openLabel={label}
      />
      {hasChildren ? (
        <>
          <div className="kh-ops-org-stem" aria-hidden />
          <ul className="kh-ops-org-children">
            {node.children.map((child) => (
              <li key={child.stakeholder.id} className="kh-ops-org-child">
                <div className="kh-ops-org-stem" aria-hidden />
                <TreeBranch node={child} onOpen={onOpen} openLabel={openLabel} />
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

export function ProjectStakeholdersOrgChart({
  stakeholders,
  canMutate = false,
  onOpen,
}: {
  stakeholders: OrgChartStakeholder[];
  canMutate?: boolean;
  onOpen?: (row: OrgChartStakeholder) => void;
}) {
  const t = useTranslations('stakeholders');
  const { roots, ungrouped } = useMemo(
    () => buildForest(stakeholders),
    [stakeholders],
  );

  function actionable(row: OrgChartStakeholder): boolean {
    if (!canMutate || !onOpen) return false;
    if (row.kind === 'ai_assistant') return Boolean(row.systemId);
    return true;
  }

  function openLabel(row: OrgChartStakeholder): string | undefined {
    if (!actionable(row)) return undefined;
    if (row.kind === 'ai_assistant') return t('manageAiCost');
    if (row.kind === 'open_role') return t('manageOpenRole');
    if (row.rosterId) return t('manage');
    return t('addToRoster');
  }

  function openRow(row: OrgChartStakeholder) {
    if (actionable(row)) onOpen?.(row);
  }

  if (stakeholders.length === 0) {
    return <p className="kh-ops-empty">{t('empty')}</p>;
  }

  return (
    <div>
      <p className="kh-ops-org-hint">{t('orgChartHint')}</p>

      {roots.length > 0 ? (
        <div className="kh-ops-org-tree-wrap">
          <div className="kh-ops-org-tree">
            {roots.map((root) => (
              <TreeBranch
                key={root.stakeholder.id}
                node={root}
                onOpen={canMutate ? openRow : undefined}
                openLabel={openLabel}
              />
            ))}
          </div>
        </div>
      ) : (
        <p className="kh-ops-empty">{t('orgChartNoHierarchy')}</p>
      )}

      {ungrouped.length > 0 ? (
        <div className="kh-ops-org-ungrouped">
          <h3>{t('orgChartUngrouped')}</h3>
          <ul className="kh-ops-org-ungrouped-grid">
            {ungrouped.map((row) => (
              <li key={row.id}>
                <StakeholderCard
                  stakeholder={row}
                  onOpen={canMutate && actionable(row) ? () => openRow(row) : undefined}
                  openLabel={openLabel(row)}
                />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
