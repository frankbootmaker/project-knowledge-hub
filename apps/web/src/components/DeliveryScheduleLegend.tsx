'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '../lib/cn';
import {
  deliveryScheduleSurfaceClass,
  type DeliveryScheduleTone,
} from '../lib/delivery-schedule';

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
        className="inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-line text-xs font-semibold text-ink-muted hover:bg-brand-soft hover:text-ink"
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
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium',
                deliveryScheduleSurfaceClass(tone),
              )}
            >
              <span
                className={cn(
                  'size-2 shrink-0 rounded-full',
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
