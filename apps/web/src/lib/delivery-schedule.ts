/** Schedule health for delivery board/calendar color coding. */

export type DeliveryScheduleTone = 'onTrack' | 'atRisk' | 'overdue' | 'completed' | 'neutral';

const AT_RISK_DAYS = 3;

export function todayYmd(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function daysUntil(dateYmd: string, today: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateYmd) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) {
    return null;
  }
  const due = Date.UTC(
    Number(dateYmd.slice(0, 4)),
    Number(dateYmd.slice(5, 7)) - 1,
    Number(dateYmd.slice(8, 10)),
  );
  const base = Date.UTC(
    Number(today.slice(0, 4)),
    Number(today.slice(5, 7)) - 1,
    Number(today.slice(8, 10)),
  );
  return Math.round((due - base) / 86_400_000);
}

/**
 * - completed: done (blue)
 * - overdue: past due / target and not done/cancelled (red)
 * - atRisk: due within 3 days inclusive (yellow)
 * - onTrack: due later, or no date, while still active (green)
 * - neutral: cancelled (or unknown)
 */
export function deliveryScheduleTone(input: {
  status: string;
  date: string | null | undefined;
  today?: string;
}): DeliveryScheduleTone {
  if (input.status === 'done') {
    return 'completed';
  }
  if (input.status === 'cancelled') {
    return 'neutral';
  }

  const today = input.today ?? todayYmd();
  if (!input.date) {
    return 'onTrack';
  }

  const delta = daysUntil(input.date, today);
  if (delta == null) {
    return 'onTrack';
  }
  if (delta < 0) {
    return 'overdue';
  }
  if (delta <= AT_RISK_DAYS) {
    return 'atRisk';
  }
  return 'onTrack';
}

/** Card / chip surface classes for board + calendar. */
export function deliveryScheduleSurfaceClass(tone: DeliveryScheduleTone): string {
  switch (tone) {
    case 'completed':
      return 'border-brand/35 bg-brand-soft text-brand';
    case 'overdue':
      return 'border-danger/35 bg-danger-soft text-danger';
    case 'atRisk':
      return 'border-warn/40 bg-warn-soft text-warn';
    case 'onTrack':
      return 'border-accent/35 bg-accent-soft text-accent';
    default:
      return 'border-line bg-panel text-ink-muted';
  }
}

/** Project-level Red / Amber / Green from open delivery items. */
export type ProjectRagStatus = 'red' | 'amber' | 'green';

/**
 * Worst open schedule tone across tasks/milestones:
 * overdue → red, at-risk → amber, otherwise green (incl. all done / empty).
 */
export function projectDeliveryRag(
  items: Array<{ status: string; date: string | null | undefined }>,
  today?: string,
): ProjectRagStatus {
  const day = today ?? todayYmd();
  let worst: ProjectRagStatus = 'green';
  for (const item of items) {
    const tone = deliveryScheduleTone({
      status: item.status,
      date: item.date,
      today: day,
    });
    if (tone === 'overdue') return 'red';
    if (tone === 'atRisk') worst = 'amber';
  }
  return worst;
}
