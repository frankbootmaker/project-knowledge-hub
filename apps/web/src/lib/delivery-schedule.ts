/** Schedule health for delivery board/calendar color coding. */

import {
  timelineRag,
  type ProjectRagStatus,
} from '@project-knowledge-hub/domain';

export type { ProjectRagStatus };

export type DeliveryScheduleTone = 'onTrack' | 'atRisk' | 'overdue' | 'completed' | 'neutral';

/**
 * Card and calendar tone only. Project health uses TIMELINE_AT_RISK_DAYS (7)
 * via timelineRag / projectDeliveryRag, not this window.
 */
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

/**
 * Project timeline RAG. Uses the shared 7-day window (TIMELINE_AT_RISK_DAYS),
 * not the 3-day card tone from deliveryScheduleTone.
 * Overdue → red, due within 7 days → amber, otherwise green.
 */
export function projectDeliveryRag(
  items: Array<{ status: string; date: string | null | undefined }>,
  today?: string,
): ProjectRagStatus {
  return timelineRag(items, today);
}
