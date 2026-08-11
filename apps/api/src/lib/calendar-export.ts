import { renderHtmlDocumentToPdf } from './knowledge-export.js';

export type CalendarExportItem = {
  id: string;
  kind: 'task' | 'milestone';
  title: string;
  date: string;
  status: string;
  humanKey?: string | null;
  ownerName?: string | null;
};

const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

type ScheduleTone = 'onTrack' | 'atRisk' | 'overdue' | 'completed' | 'neutral';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/** Monday-based offset for the 1st of the month (0 = Monday). */
function mondayOffset(year: number, monthIndex: number): number {
  const weekday = new Date(Date.UTC(year, monthIndex, 1)).getUTCDay();
  return (weekday + 6) % 7;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function scheduleTone(
  status: string,
  date: string,
  today: string,
): ScheduleTone {
  if (status === 'done') return 'completed';
  if (status === 'cancelled') return 'neutral';
  const due = Date.UTC(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    Number(date.slice(8, 10)),
  );
  const base = Date.UTC(
    Number(today.slice(0, 4)),
    Number(today.slice(5, 7)) - 1,
    Number(today.slice(8, 10)),
  );
  const delta = Math.round((due - base) / 86_400_000);
  if (delta < 0) return 'overdue';
  if (delta <= 3) return 'atRisk';
  return 'onTrack';
}

function toneClass(tone: ScheduleTone): string {
  switch (tone) {
    case 'completed':
      return 'tone-completed';
    case 'overdue':
      return 'tone-overdue';
    case 'atRisk':
      return 'tone-atrisk';
    case 'onTrack':
      return 'tone-ontrack';
    default:
      return 'tone-neutral';
  }
}

export function buildCalendarHtml(input: {
  title: string;
  projectName: string;
  year: number;
  monthIndex: number;
  today: string;
  items: CalendarExportItem[];
  labels: {
    generated: string;
    empty: string;
    more: string;
    milestone: string;
    task: string;
    weekdays: Record<(typeof WEEKDAY_KEYS)[number], string>;
    monthLabel: string;
  };
}): string {
  const generated = new Date().toISOString().slice(0, 10);
  const byDate = new Map<string, CalendarExportItem[]>();
  for (const item of input.items) {
    if (!item.date.startsWith(
      `${input.year}-${pad2(input.monthIndex + 1)}`,
    )) {
      continue;
    }
    const list = byDate.get(item.date) ?? [];
    list.push(item);
    byDate.set(item.date, list);
  }

  const totalDays = daysInMonth(input.year, input.monthIndex);
  const offset = mondayOffset(input.year, input.monthIndex);
  const cells: Array<{
    day: number | null;
    iso: string | null;
    items: CalendarExportItem[];
  }> = [];

  for (let i = 0; i < offset; i += 1) {
    cells.push({ day: null, iso: null, items: [] });
  }
  for (let day = 1; day <= totalDays; day += 1) {
    const iso = `${input.year}-${pad2(input.monthIndex + 1)}-${pad2(day)}`;
    cells.push({
      day,
      iso,
      items: byDate.get(iso) ?? [],
    });
  }
  while (cells.length % 7 !== 0) {
    cells.push({ day: null, iso: null, items: [] });
  }

  const weekdayHeader = WEEKDAY_KEYS.map(
    (key) =>
      `<div class="weekday">${escapeHtml(input.labels.weekdays[key])}</div>`,
  ).join('');

  const cellsHtml = cells
    .map((cell) => {
      if (cell.day == null || !cell.iso) {
        return `<div class="cell empty"></div>`;
      }
      const isToday = cell.iso === input.today;
      const visible = cell.items.slice(0, 6);
      const overflow = cell.items.length - visible.length;
      const itemsHtml = visible
        .map((item) => {
          const tone = scheduleTone(item.status, item.date, input.today);
          const kind =
            item.kind === 'milestone'
              ? input.labels.milestone
              : input.labels.task;
          return `<div class="item ${toneClass(tone)}" title="${escapeHtml(item.humanKey ? `${item.humanKey} · ${item.title}` : item.title)}">
  <div class="item-row">
    <span class="kind">${escapeHtml(item.ownerName ?? kind.slice(0, 1))}</span>
    <span class="title">${escapeHtml(item.title)}</span>
  </div>
  ${item.humanKey ? `<div class="item-id">${escapeHtml(item.humanKey)}</div>` : ''}
</div>`;
        })
        .join('');
      const moreHtml =
        overflow > 0
          ? `<div class="more">${escapeHtml(
              input.labels.more.replace('{count}', String(overflow)),
            )}</div>`
          : '';
      return `<div class="cell${isToday ? ' today' : ''}">
  <div class="day">${cell.day}</div>
  <div class="items">${itemsHtml}${moreHtml}</div>
</div>`;
    })
    .join('');

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
    h1 { margin: 0 0 0.2rem; font-size: 1.3rem; }
    .sub { margin: 0 0 0.35rem; color: #5b6b7c; }
    .month { margin: 0 0 0.75rem; font-size: 1.05rem; font-weight: 600; }
    .grid {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      gap: 1px;
      border: 1px solid #d5dde5;
      border-radius: 8px;
      overflow: hidden;
      background: #d5dde5;
    }
    .weekday {
      background: #f4f7fa;
      padding: 0.4rem 0.35rem;
      text-align: center;
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: #5b6b7c;
    }
    .cell {
      min-height: 5.6rem;
      background: #fff;
      padding: 0.3rem;
    }
    .cell.empty { background: #f7f9fb; }
    .cell.today { box-shadow: inset 0 0 0 1.5px rgba(58, 112, 186, 0.45); }
    .day {
      font-size: 10px;
      font-weight: 700;
      color: #5b6b7c;
      margin-bottom: 0.2rem;
    }
    .items { display: grid; gap: 0.18rem; }
    .item {
      display: flex;
      align-items: flex-start;
      gap: 0.2rem;
      padding: 0.12rem 0.25rem;
      border: 1px solid #d5dde5;
      border-radius: 3px;
      font-size: 8px;
      line-height: 1.25;
      overflow: hidden;
    }
    .item .kind {
      flex: 0 0 auto;
      max-width: 5.5rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-weight: 700;
      color: #3d4f61;
    }
    .item-row {
      display: flex;
      align-items: center;
      gap: 0.2rem;
      min-width: 0;
    }
    .item .title {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .item-id {
      margin-top: 1px;
      font-size: 7px;
      opacity: 0.8;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .tone-completed { background: #e8f1ff; border-color: #9dbcea; color: #1f4b8f; }
    .tone-overdue { background: #fdecee; border-color: #efb0b8; color: #9b1c28; }
    .tone-atrisk { background: #fff6e5; border-color: #efd09a; color: #8a5a00; }
    .tone-ontrack { background: #e9f8f1; border-color: #9fd6b8; color: #146c43; }
    .tone-neutral { background: #f4f7fa; border-color: #d5dde5; color: #5b6b7c; }
    .more { font-size: 8px; color: #5b6b7c; }
    .empty-note { margin: 0.75rem 0 0; color: #5b6b7c; }
  </style>
</head>
<body>
  <h1>${escapeHtml(input.title)}</h1>
  <p class="sub">${escapeHtml(input.projectName)} · ${escapeHtml(input.labels.generated)} ${escapeHtml(generated)}</p>
  <p class="month">${escapeHtml(input.labels.monthLabel)}</p>
  <div class="grid">
    ${weekdayHeader}
    ${cellsHtml}
  </div>
  ${
    byDate.size === 0
      ? `<p class="empty-note">${escapeHtml(input.labels.empty)}</p>`
      : ''
  }
</body>
</html>`;
}

export async function buildCalendarPdf(
  input: Parameters<typeof buildCalendarHtml>[0],
): Promise<Buffer> {
  const html = buildCalendarHtml(input);
  return renderHtmlDocumentToPdf({
    html,
    title: input.title,
    landscape: true,
  });
}
