'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '../lib/cn';
import { type DeliveryScheduleTone } from '../lib/delivery-schedule';

const LEGEND: DeliveryScheduleTone[] = [
  'onTrack',
  'atRisk',
  'overdue',
  'completed',
];

export function DeliveryScheduleLegend({ className }: { className?: string }) {
  const t = useTranslations('delivery');
  const panelId = useId();
  const [open, setOpen] = useState(false);

  return (
    <div className={cn('flex flex-wrap items-start gap-2', className)}>
      <button
        type="button"
        className="kh-ops-help-btn"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={t('scheduleLegendHelp')}
        title={t('scheduleLegendHelp')}
        onClick={() => setOpen((current) => !current)}
      >
        ?
      </button>
      {open ? (
        <ul
          id={panelId}
          className="m-0 flex list-none flex-wrap items-center gap-2 p-0"
          aria-label={t('scheduleLegendLabel')}
        >
          {LEGEND.map((tone) => (
            <li
              key={tone}
              className="kh-ops-type-chip"
              data-tone={tone}
            >
              <span
                className={cn(
                  'size-1.5 shrink-0',
                  tone === 'onTrack' && 'bg-accent',
                  tone === 'atRisk' && 'bg-warn',
                  tone === 'overdue' && 'bg-danger',
                  tone === 'completed' && 'bg-brand',
                )}
                aria-hidden
              />
              <span className="sm:hidden">{t(`scheduleToneShort.${tone}`)}</span>
              <span className="hidden sm:inline">{t(`scheduleTone.${tone}`)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
