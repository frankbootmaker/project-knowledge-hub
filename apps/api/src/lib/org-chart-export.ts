import type { BlobStore } from '@project-knowledge-hub/blob-store';
import { users, type Database } from '@project-knowledge-hub/database';
import { resolveAssistantBrand } from '@project-knowledge-hub/domain';
import { inArray } from 'drizzle-orm';
import { readAvatarFile } from './avatars.js';
import { renderHtmlDocumentToPdf } from './knowledge-export.js';
import type { PublicStakeholder } from './project-stakeholders.js';

type TreeNode = {
  stakeholder: PublicStakeholder;
  children: TreeNode[];
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildForest(stakeholders: PublicStakeholder[]): {
  roots: TreeNode[];
  ungrouped: PublicStakeholder[];
} {
  const byId = new Map(stakeholders.map((row) => [row.id, row]));
  const childIds = new Set<string>();
  const childrenOf = new Map<string, string[]>();

  for (const row of stakeholders) {
    const managerUserId = row.reportsToUserId;
    if (!managerUserId || managerUserId === row.userId) continue;
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

  return {
    roots,
    ungrouped: stakeholders.filter((row) => !inTree.has(row.id)),
  };
}

function brandLabel(stakeholder: PublicStakeholder): string {
  const brand =
    stakeholder.assistantBrand ??
    resolveAssistantBrand({
      name: stakeholder.displayName,
      slug: stakeholder.systemSlug,
    });
  switch (brand) {
    case 'cursor':
      return 'Cursor';
    case 'openai':
      return 'OpenAI';
    case 'claude':
      return 'Claude';
    case 'gemini':
      return 'Gemini';
    case 'ollama':
      return 'Ollama';
    case 'openwebui':
      return 'Open WebUI';
    default:
      return 'AI';
  }
}

function monogram(displayName: string, fullName: string | null): string {
  const source = (fullName || displayName).trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`.toUpperCase();
  }
  return source.slice(0, 2).toUpperCase() || '?';
}

function cardHtml(
  stakeholder: PublicStakeholder,
  avatarDataUris: Record<string, string>,
): string {
  const isAi = stakeholder.kind === 'ai_assistant';
  const role = isAi
    ? 'AI assistant'
    : stakeholder.projectRole
      ? stakeholder.projectRole.replace(/_/g, ' ')
      : 'From delivery';
  const dataUri =
    !isAi && stakeholder.userId
      ? avatarDataUris[stakeholder.userId]
      : undefined;
  const avatar = dataUri
    ? `<img class="avatar" src="${dataUri}" alt="" />`
    : isAi
      ? `<div class="avatar ai">${escapeHtml(brandLabel(stakeholder).slice(0, 2))}</div>`
      : `<div class="avatar person">${escapeHtml(monogram(stakeholder.displayName, stakeholder.fullName))}</div>`;

  const metaBits = [
    stakeholder.email,
    !isAi ? stakeholder.jobTitle : null,
    isAi ? brandLabel(stakeholder) : null,
  ].filter(Boolean);

  return `<article class="card ${isAi ? 'ai' : 'person'}">
    ${avatar}
    <div class="body">
      <div class="name">${escapeHtml(stakeholder.displayName)}</div>
      <div class="role">${escapeHtml(role)}</div>
      ${metaBits.length ? `<div class="meta">${escapeHtml(metaBits.join(' · '))}</div>` : ''}
    </div>
  </article>`;
}

function treeHtml(
  node: TreeNode,
  avatarDataUris: Record<string, string>,
): string {
  const children = node.children;
  if (children.length === 0) {
    return `<div class="node">${cardHtml(node.stakeholder, avatarDataUris)}</div>`;
  }

  const childItems = children
    .map((child, index) => {
      const isFirst = index === 0;
      const isLast = index === children.length - 1;
      const multi = children.length > 1;
      return `<li class="child ${multi ? 'multi' : 'solo'} ${isFirst ? 'first' : ''} ${isLast ? 'last' : ''}">
        <div class="stem"></div>
        ${treeHtml(child, avatarDataUris)}
      </li>`;
    })
    .join('');

  return `<div class="node">
    ${cardHtml(node.stakeholder, avatarDataUris)}
    <div class="down"></div>
    <ul class="children">${childItems}</ul>
  </div>`;
}

/** Read profile photos from disk/blob and return data URIs for PDF embedding. */
export async function loadAvatarDataUrisForUsers(
  database: Database,
  avatarUploadDir: string,
  userIds: string[],
  options?: { blobStore?: BlobStore },
): Promise<Record<string, string>> {
  const unique = [...new Set(userIds.filter(Boolean))];
  if (unique.length === 0) return {};

  const rows = await database.db
    .select({
      id: users.id,
      avatarContentType: users.avatarContentType,
    })
    .from(users)
    .where(inArray(users.id, unique));

  const entries = await Promise.all(
    rows.map(async (row) => {
      if (!row.avatarContentType) return null;
      const buffer = await readAvatarFile(avatarUploadDir, row.id, options);
      if (!buffer) return null;
      return [
        row.id,
        `data:${row.avatarContentType};base64,${buffer.toString('base64')}`,
      ] as const;
    }),
  );

  const out: Record<string, string> = {};
  for (const entry of entries) {
    if (entry) out[entry[0]] = entry[1];
  }
  return out;
}

export function buildOrgChartHtml(input: {
  title: string;
  projectName: string;
  stakeholders: PublicStakeholder[];
  avatarDataUris?: Record<string, string>;
  generatedAt?: Date;
}): string {
  const { roots, ungrouped } = buildForest(input.stakeholders);
  const avatarDataUris = input.avatarDataUris ?? {};
  const generated = (input.generatedAt ?? new Date()).toISOString();

  const rootsHtml =
    roots.length > 0
      ? roots.map((root) => treeHtml(root, avatarDataUris)).join('')
      : `<p class="empty">No reporting hierarchy yet.</p>`;

  const ungroupedHtml =
    ungrouped.length > 0
      ? `<section class="ungrouped">
          <h2>Ungrouped</h2>
          <div class="grid">${ungrouped.map((row) => cardHtml(row, avatarDataUris)).join('')}</div>
        </section>`
      : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(input.title)}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 8px 4px;
      font-family: "Segoe UI", system-ui, sans-serif;
      color: #1a1a1a;
      background: #fff;
    }
    h1 { font-size: 18px; margin: 0 0 4px; }
    .sub { font-size: 11px; color: #666; margin: 0 0 16px; }
    .forest { display: flex; flex-direction: column; align-items: center; gap: 28px; }
    .node { display: flex; flex-direction: column; align-items: center; }
    .down { width: 1px; height: 14px; background: #94a3b8; }
    .children {
      display: flex;
      justify-content: center;
      align-items: flex-start;
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .child {
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 0 10px;
    }
    .child.multi::before {
      content: "";
      position: absolute;
      top: 0;
      height: 1px;
      background: #94a3b8;
    }
    .child.multi.first::before { left: 50%; right: 0; }
    .child.multi.last::before { left: 0; right: 50%; }
    .child.multi:not(.first):not(.last)::before { left: 0; right: 0; }
    .stem { width: 1px; height: 14px; background: #94a3b8; }
    .card {
      width: 190px;
      border: 1px solid #d0d5dd;
      border-radius: 10px;
      padding: 10px;
      background: #fff;
      display: flex;
      gap: 8px;
      align-items: flex-start;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06);
    }
    .card.ai { border-color: #93c5fd; background: #f8fbff; }
    .avatar {
      width: 36px;
      height: 36px;
      border-radius: 999px;
      object-fit: cover;
      flex-shrink: 0;
      border: 1px solid #d0d5dd;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      font-weight: 700;
      background: #e0e7ff;
      color: #3730a3;
    }
    .avatar.ai { background: #0f172a; color: #f8fafc; border-color: #0f172a; }
    .name { font-size: 12px; font-weight: 700; line-height: 1.25; }
    .role { font-size: 10px; color: #475569; text-transform: capitalize; margin-top: 2px; }
    .meta { font-size: 9px; color: #64748b; margin-top: 4px; word-break: break-word; }
    .ungrouped { margin-top: 24px; }
    .ungrouped h2 { font-size: 13px; margin: 0 0 10px; }
    .grid { display: flex; flex-wrap: wrap; gap: 10px; }
    .empty { color: #64748b; font-size: 12px; }
  </style>
</head>
<body>
  <h1>${escapeHtml(input.title)}</h1>
  <p class="sub">${escapeHtml(input.projectName)} · Generated ${escapeHtml(generated)}</p>
  <div class="forest">${rootsHtml}</div>
  ${ungroupedHtml}
</body>
</html>`;
}

export async function buildOrgChartPdf(input: {
  title: string;
  projectName: string;
  stakeholders: PublicStakeholder[];
  avatarDataUris?: Record<string, string>;
}): Promise<Buffer> {
  const html = buildOrgChartHtml(input);
  return renderHtmlDocumentToPdf({
    html,
    title: input.title,
    landscape: true,
  });
}
