'use client';

import { useLocale, useTranslations } from 'next-intl';
import { formatPercentLabel } from '../lib/delivery-completion';
import { formatLocaleDate } from '../lib/locale-date';

export type MilestoneMarker = {
  id: string;
  title: string;
  status: string;
  targetDate: string | null;
  humanKey?: string | null;
  completionPercent?: number | null;
  /** Included-item count. percent stays 0 or 100; done is how many are complete. */
  completion?: { percent: number; done: number; total: number } | null;
};

export function compareMilestonesByDueDate(a: MilestoneMarker, b: MilestoneMarker): number {
  if (a.targetDate && b.targetDate && a.targetDate !== b.targetDate) {
    return a.targetDate < b.targetDate ? -1 : 1;
  }
  if (a.targetDate && !b.targetDate) return -1;
  if (!a.targetDate && b.targetDate) return 1;
  return a.title.localeCompare(b.title);
}

export function MilestoneTimeMarkers({
  milestones,
  onManage,
}: {
  milestones: MilestoneMarker[];
  onManage?: (milestoneId: string) => void;
}) {
  const t = useTranslations('delivery');
  const locale = useLocale();
  const ordered = [...milestones].sort(compareMilestonesByDueDate);
  if (ordered.length === 0) return null;

  return (
    <section className="kh-ops-milestone-markers" aria-label={t('milestoneTimeOrder')}>
      <h3 className="kh-ops-milestone-markers-title">{t('milestoneTimeOrder')}</h3>
      <div className="kh-ops-milestone-markers-row">
        {ordered.map((milestone) => {
          const percent =
            milestone.completionPercent == null
              ? null
              : formatPercentLabel(milestone.completionPercent, locale);
          const due = milestone.targetDate
            ? formatLocaleDate(milestone.targetDate, locale)
            : t('milestoneNoDue');
          return (
            <button
              key={milestone.id}
              type="button"
              className="kh-ops-milestone-marker"
              onClick={() => onManage?.(milestone.id)}
            >
              <time dateTime={milestone.targetDate ?? undefined}>{due}</time>
              <span className="kh-ops-milestone-marker-title">
                {milestone.humanKey ? (
                  <span className="kh-ops-key-badge">{milestone.humanKey}</span>
                ) : null}
                {milestone.title}
              </span>
              <span className="kh-ops-milestone-marker-meta">
                {t(`milestoneStatus.${milestone.status}`)}
                {percent ? ` · ${percent}` : ''}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
