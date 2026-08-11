import { renderHtmlDocumentToPdf } from './knowledge-export.js';

export type BoardExportMetaFilters = {
  showStory: boolean;
  showMilestone: boolean;
  showOwner: boolean;
  showAccountable: boolean;
  showDueDate: boolean;
  showStoryPoints: boolean;
};

export type BoardExportTask = {
  id: string;
  title: string;
  status: string;
  dueDate: string | null;
  storyPoints: number | null;
  userStoryTitle: string | null;
  milestoneTitle: string | null;
  currentOwnerName: string | null;
  accountableName: string | null;
};

export type BoardExportMilestone = {
  id: string;
  title: string;
  status: string;
  targetDate: string | null;
};

const BOARD_COLUMNS = [
  'todo',
  'in_progress',
  'blocked',
  'done',
  'cancelled',
] as const;

function milestoneBoardColumn(status: string): (typeof BOARD_COLUMNS)[number] {
  if (status === 'active') return 'in_progress';
  if (status === 'done') return 'done';
  if (status === 'cancelled') return 'cancelled';
  return 'todo';
}

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

export function buildBoardHtml(input: {
  title: string;
  projectName: string;
  tasks: BoardExportTask[];
  milestones: BoardExportMilestone[];
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
    status: Record<string, string>;
    milestoneStatus: Record<string, string>;
  };
}): string {
  const generated = new Date().toISOString().slice(0, 10);

  const columnsHtml = BOARD_COLUMNS.map((status) => {
    const columnTasks = input.tasks.filter((task) => task.status === status);
    const columnMilestones = input.milestones.filter(
      (milestone) => milestoneBoardColumn(milestone.status) === status,
    );
    const milestoneCards = columnMilestones
      .map((milestone) => {
        const tags: string[] = [];
        tags.push(
          metaTagHtml(
            input.labels.milestone,
            input.labels.milestoneStatus[milestone.status] ?? milestone.status,
          ),
        );
        if (input.meta.showDueDate && milestone.targetDate) {
          tags.push(metaTagHtml(input.labels.dueDate, milestone.targetDate));
        }
        return `<article class="card milestone-card">
  <div class="card-title">${escapeHtml(milestone.title)}</div>
  <div class="tags">${tags.join('')}</div>
</article>`;
      })
      .join('');
    const taskCards = columnTasks
      .map((task) => {
        const tags: string[] = [];
        if (input.meta.showStory && task.userStoryTitle) {
          tags.push(metaTagHtml(input.labels.story, task.userStoryTitle));
        }
        if (input.meta.showMilestone && task.milestoneTitle) {
          tags.push(metaTagHtml(input.labels.milestone, task.milestoneTitle));
        }
        if (input.meta.showAccountable && task.accountableName) {
          tags.push(
            metaTagHtml(input.labels.accountable, task.accountableName),
          );
        }
        if (input.meta.showOwner && task.currentOwnerName) {
          tags.push(metaTagHtml(input.labels.owner, task.currentOwnerName));
        }
        if (input.meta.showDueDate && task.dueDate) {
          tags.push(metaTagHtml(input.labels.dueDate, task.dueDate));
        }
        if (
          input.meta.showStoryPoints &&
          task.storyPoints != null &&
          Number.isFinite(task.storyPoints)
        ) {
          tags.push(
            metaTagHtml(input.labels.storyPoints, String(task.storyPoints)),
          );
        }
        return `<article class="card">
  <div class="card-title">${escapeHtml(task.title)}</div>
  ${tags.length > 0 ? `<div class="tags">${tags.join('')}</div>` : ''}
</article>`;
      })
      .join('');
    const cards = `${milestoneCards}${taskCards}`;
    const count = columnTasks.length + columnMilestones.length;

    return `<section class="column">
  <header><h2>${escapeHtml(input.labels.status[status] ?? status)}</h2><span>${count}</span></header>
  <div class="cards">${cards || `<p class="empty-col">${escapeHtml(input.labels.empty)}</p>`}</div>
</section>`;
  }).join('');

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
    .sub { margin: 0 0 0.85rem; color: #5b6b7c; }
    .board {
      display: flex;
      gap: 0.55rem;
      align-items: flex-start;
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
    .milestone-card { border-style: dashed; }
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
  <div class="board">${columnsHtml}</div>
</body>
</html>`;
}

export async function buildBoardPdf(input: Parameters<typeof buildBoardHtml>[0]): Promise<Buffer> {
  const html = buildBoardHtml(input);
  return renderHtmlDocumentToPdf({
    html,
    title: input.title,
    landscape: true,
  });
}
