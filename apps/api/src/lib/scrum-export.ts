import { renderHtmlDocumentToPdf } from './knowledge-export.js';
import type { BoardExportMetaFilters, BoardExportTask } from './board-export.js';

const BOARD_COLUMNS = [
  'todo',
  'in_progress',
  'blocked',
  'done',
  'cancelled',
] as const;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function metaTagHtml(label: string, value: string): string {
  return `<div class="tag"><span class="kind">${escapeHtml(label)}</span>${escapeHtml(value)}</div>`;
}

function taskCardHtml(
  task: BoardExportTask,
  meta: BoardExportMetaFilters,
  labels: {
    story: string;
    milestone: string;
    owner: string;
    accountable: string;
    dueDate: string;
    storyPoints: string;
  },
): string {
  const tags: string[] = [];
  if (meta.showStory && task.userStoryTitle) {
    tags.push(metaTagHtml(labels.story, task.userStoryTitle));
  }
  if (meta.showMilestone && task.milestoneTitle) {
    tags.push(metaTagHtml(labels.milestone, task.milestoneTitle));
  }
  if (meta.showAccountable && task.accountableName) {
    tags.push(metaTagHtml(labels.accountable, task.accountableName));
  }
  if (meta.showOwner && task.currentOwnerName) {
    tags.push(metaTagHtml(labels.owner, task.currentOwnerName));
  }
  if (meta.showDueDate && task.dueDate) {
    tags.push(metaTagHtml(labels.dueDate, task.dueDate));
  }
  if (
    meta.showStoryPoints &&
    task.storyPoints != null &&
    Number.isFinite(task.storyPoints)
  ) {
    tags.push(metaTagHtml(labels.storyPoints, String(task.storyPoints)));
  }
  const title =
    meta.showIssueId && task.humanKey
      ? `${task.humanKey} · ${task.title}`
      : task.title;
  return `<article class="card">
  <div class="card-title">${escapeHtml(title)}</div>
  ${tags.length > 0 ? `<div class="tags">${tags.join('')}</div>` : ''}
</article>`;
}

function columnHtml(input: {
  title: string;
  count: number;
  cardsHtml: string;
  emptyLabel: string;
}): string {
  return `<section class="column">
  <header><h2>${escapeHtml(input.title)}</h2><span>${input.count}</span></header>
  <div class="cards">${
    input.cardsHtml ||
    `<p class="empty-col">${escapeHtml(input.emptyLabel)}</p>`
  }</div>
</section>`;
}

export type ScrumExportSprint = {
  name: string;
  humanKey: string | null;
  goal: string | null;
  status: string;
  startDate: string | null;
  endDate: string | null;
  capacityPoints: number | null;
  committedPoints: number;
  donePoints: number;
};

export type ScrumExportSections = {
  includeBurndown: boolean;
  includeBoard: boolean;
  includeBacklog: boolean;
};

export type ScrumExportBurndown = {
  committedPoints: number;
  startDate: string | null;
  endDate: string | null;
  points: Array<{
    date: string;
    idealRemaining: number;
    remaining: number;
  }>;
};

function burndownSvgHtml(
  burndown: ScrumExportBurndown,
  emptyLabel: string,
): string {
  const { committedPoints, startDate, endDate, points } = burndown;
  if (
    committedPoints <= 0 ||
    !startDate ||
    !endDate ||
    points.length === 0
  ) {
    return `<p class="empty-col">${escapeHtml(emptyLabel)}</p>`;
  }

  const width = 720;
  const height = 220;
  const pad = { top: 16, right: 16, bottom: 32, left: 48 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return `<p class="empty-col">${escapeHtml(emptyLabel)}</p>`;
  }

  const xFor = (ymd: string) => {
    const tMs = Date.parse(`${ymd}T00:00:00Z`);
    const ratio = Math.min(1, Math.max(0, (tMs - start) / (end - start)));
    return pad.left + ratio * innerW;
  };
  const yFor = (remaining: number) =>
    pad.top +
    (1 - Math.min(1, Math.max(0, remaining / committedPoints))) * innerH;

  const idealPath = `M ${pad.left} ${yFor(committedPoints)} L ${pad.left + innerW} ${yFor(0)}`;
  const actual = points
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((row) => ({ x: xFor(row.date), y: yFor(row.remaining) }));
  const actualPath =
    actual.length > 0
      ? actual
          .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
          .join(' ')
      : null;

  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="220" xmlns="http://www.w3.org/2000/svg" role="img">
  <line x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${pad.top + innerH}" stroke="#c5ced6" />
  <line x1="${pad.left}" y1="${pad.top + innerH}" x2="${pad.left + innerW}" y2="${pad.top + innerH}" stroke="#c5ced6" />
  <path d="${idealPath}" fill="none" stroke="#5b6b7c" stroke-dasharray="4 4" stroke-width="1.5" />
  ${
    actualPath
      ? `<path d="${actualPath}" fill="none" stroke="#1f6feb" stroke-width="2" />`
      : ''
  }
  <text x="${pad.left}" y="${height - 8}" fill="#5b6b7c" font-size="10">${escapeHtml(startDate)}</text>
  <text x="${pad.left + innerW}" y="${height - 8}" text-anchor="end" fill="#5b6b7c" font-size="10">${escapeHtml(endDate)}</text>
  <text x="4" y="${pad.top + 4}" fill="#5b6b7c" font-size="10">${committedPoints}</text>
</svg>
<p class="chart-legend"><span class="ideal">— —</span> ideal · <span class="actual">——</span> remaining</p>`;
}

export function buildScrumHtml(input: {
  title: string;
  projectName: string;
  sprint: ScrumExportSprint;
  sprintTasks: BoardExportTask[];
  backlogTasks: BoardExportTask[];
  burndown: ScrumExportBurndown | null;
  sections: ScrumExportSections;
  meta: BoardExportMetaFilters;
  labels: {
    story: string;
    milestone: string;
    owner: string;
    accountable: string;
    dueDate: string;
    storyPoints: string;
    generated: string;
    empty: string;
    backlog: string;
    sprintBoard: string;
    burndown: string;
    burndownEmpty: string;
    goal: string;
    capacity: string;
    window: string;
    status: Record<string, string>;
    sprintStatus: Record<string, string>;
  };
}): string {
  const generated = new Date().toISOString().slice(0, 10);
  const sprintLabel =
    (input.sprint.humanKey ? `${input.sprint.humanKey} · ` : '') +
    input.sprint.name;
  const statusLabel =
    input.labels.sprintStatus[input.sprint.status] ?? input.sprint.status;
  const pointsLabel =
    `${input.sprint.committedPoints}` +
    (input.sprint.capacityPoints != null
      ? ` / ${input.sprint.capacityPoints}`
      : '') +
    ` · ${input.sprint.donePoints} done`;
  const windowLabel =
    [input.sprint.startDate, input.sprint.endDate].filter(Boolean).join(' → ') ||
    '—';

  const sections: string[] = [];

  if (input.sections.includeBurndown) {
    sections.push(`<section class="export-section">
  <p class="section-title">${escapeHtml(input.labels.burndown)}</p>
  <div class="burndown">${
    input.burndown
      ? burndownSvgHtml(input.burndown, input.labels.burndownEmpty)
      : `<p class="empty-col">${escapeHtml(input.labels.burndownEmpty)}</p>`
  }</div>
</section>`);
  }

  if (input.sections.includeBoard) {
    const boardColumns = BOARD_COLUMNS.map((status) => {
      const columnTasks = input.sprintTasks.filter(
        (task) => task.status === status,
      );
      const cards = columnTasks
        .map((task) => taskCardHtml(task, input.meta, input.labels))
        .join('');
      return columnHtml({
        title: input.labels.status[status] ?? status,
        count: columnTasks.length,
        cardsHtml: cards,
        emptyLabel: input.labels.empty,
      });
    }).join('');
    sections.push(`<section class="export-section">
  <p class="section-title">${escapeHtml(input.labels.sprintBoard)}</p>
  <div class="board">${boardColumns}</div>
</section>`);
  }

  if (input.sections.includeBacklog) {
    const backlogCards = input.backlogTasks
      .map((task) => taskCardHtml(task, input.meta, input.labels))
      .join('');
    const backlogColumn = columnHtml({
      title: input.labels.backlog,
      count: input.backlogTasks.length,
      cardsHtml: backlogCards,
      emptyLabel: input.labels.empty,
    });
    sections.push(`<section class="export-section">
  <div class="backlog-row">${backlogColumn}</div>
</section>`);
  }

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(input.title)}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: system-ui, -apple-system, Segoe UI, sans-serif;
      color: #15202b;
      margin: 1rem;
      font-size: 11px;
    }
    h1 { margin: 0 0 0.25rem; font-size: 1.35rem; }
    .sub { margin: 0 0 0.55rem; color: #5b6b7c; }
    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: 0.45rem 1rem;
      margin: 0 0 0.85rem;
      color: #5b6b7c;
    }
    .meta strong { color: #15202b; font-weight: 600; }
    .section-title {
      margin: 0 0 0.45rem;
      font-size: 12px;
      font-weight: 700;
    }
    .export-section { margin-bottom: 1rem; }
    .burndown {
      border: 1px solid #d5dde5;
      border-radius: 8px;
      padding: 0.55rem;
      background: #fff;
    }
    .chart-legend {
      margin: 0.35rem 0 0;
      color: #5b6b7c;
      font-size: 10px;
    }
    .chart-legend .ideal { color: #5b6b7c; }
    .chart-legend .actual { color: #1f6feb; font-weight: 600; }
    .board {
      display: flex;
      gap: 0.55rem;
      align-items: flex-start;
    }
    .backlog-row {
      display: flex;
      gap: 0.55rem;
      align-items: flex-start;
    }
    .backlog-row .column {
      width: 17.5rem;
      flex: 0 0 17.5rem;
    }
    .column {
      flex: 1 1 0;
      min-width: 0;
      border: 1px solid #d5dde5;
      border-radius: 8px;
      background: #f4f7fa;
      overflow: hidden;
    }
    .column header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 0.35rem;
      padding: 0.4rem 0.55rem;
      border-bottom: 1px solid #d5dde5;
      background: #fff;
    }
    .column h2 { margin: 0; font-size: 11px; }
    .column header span { color: #5b6b7c; font-size: 10px; }
    .cards { display: grid; gap: 0.4rem; padding: 0.45rem; }
    .card {
      border: 1px solid #d5dde5;
      border-radius: 6px;
      padding: 0.4rem 0.45rem;
      background: #fff;
    }
    .card-title { font-weight: 600; font-size: 11px; margin-bottom: 0.3rem; }
    .tags { display: flex; flex-wrap: wrap; gap: 0.3rem; }
    .tag {
      max-width: 100%;
      padding: 0.12rem 0.35rem;
      border: 1px solid #c5ced6;
      border-radius: 4px;
      background: #fff;
      font-size: 8px;
      line-height: 1.25;
    }
    .tag .kind {
      display: block;
      margin-bottom: 0.08rem;
      color: #5b6b7c;
      font-size: 7px;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    .empty-col { margin: 0.75rem 0; text-align: center; color: #5b6b7c; font-size: 10px; }
  </style>
</head>
<body>
  <h1>${escapeHtml(input.title)}</h1>
  <p class="sub">${escapeHtml(input.projectName)} · ${escapeHtml(input.labels.generated)} ${escapeHtml(generated)}</p>
  <div class="meta">
    <span><strong>${escapeHtml(sprintLabel)}</strong> (${escapeHtml(statusLabel)})</span>
    <span>${escapeHtml(input.labels.window)}: ${escapeHtml(windowLabel)}</span>
    <span>${escapeHtml(input.labels.capacity)}: ${escapeHtml(pointsLabel)}</span>
    ${
      input.sprint.goal?.trim()
        ? `<span>${escapeHtml(input.labels.goal)}: ${escapeHtml(input.sprint.goal.trim())}</span>`
        : ''
    }
  </div>
  ${sections.join('\n')}
</body>
</html>`;
}

export async function buildScrumPdf(
  input: Parameters<typeof buildScrumHtml>[0],
): Promise<Buffer> {
  const html = buildScrumHtml(input);
  return renderHtmlDocumentToPdf({
    html,
    title: input.title,
    landscape: true,
  });
}
