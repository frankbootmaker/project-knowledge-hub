'use client';

import { useTranslations } from 'next-intl';
import { capacityStack, formatHours, formatStackPct, stackSummary } from '../lib/utilization-bar';

export function UtilizationStackBar({
  name,
  burnHours,
  plannedHours,
  capacityHours,
}: {
  name: string;
  burnHours: number;
  plannedHours: number;
  capacityHours: number | null;
}) {
  const t = useTranslations('utilization');
  const stack = capacityStack({ burnHours, plannedHours, capacityHours });
  const summary = stackSummary((key, values) => t(key as 'barSummary', values), name, stack);
  const rows: Array<{ key: string; label: string; value: string }> = [
    { key: 'burned', label: t('burned'), value: formatHours(stack.burnHours) },
    {
      key: 'planned',
      label: t('plannedDemand'),
      value: formatHours(stack.plannedHours),
    },
    { key: 'total', label: t('total'), value: formatHours(stack.totalHours) },
    {
      key: 'capacity',
      label: t('capacity'),
      value: formatHours(stack.capacityHours),
    },
    { key: 'pct', label: t('pct'), value: formatStackPct(stack.totalPct) },
  ];

  return (
    <div className={stack.overflow ? 'kh-ops-capacity-bar is-over' : 'kh-ops-capacity-bar'}>
      <div
        className="kh-ops-capacity-track"
        role="img"
        tabIndex={0}
        aria-label={summary}
        data-total-hours={stack.totalHours}
        data-total-pct={stack.totalPct ?? ''}
        data-overflow={stack.overflow ? 'true' : 'false'}
      >
        <span
          className="kh-ops-capacity-burn"
          data-segment="burn"
          style={{ width: `${stack.burnWidthPct}%` }}
          aria-hidden="true"
        />
        <span
          className="kh-ops-capacity-planned"
          data-segment="planned"
          style={{
            left: `${stack.plannedLeftPct}%`,
            width: `${stack.plannedWidthPct}%`,
          }}
          aria-hidden="true"
        />
        {stack.overflow && stack.markerPct != null ? (
          <span
            className="kh-ops-capacity-overflow"
            data-segment="overflow"
            style={{
              left: `${stack.markerPct}%`,
              width: `${stack.overflowWidthPct}%`,
            }}
            aria-hidden="true"
          />
        ) : null}
        {stack.overflow && stack.markerPct != null ? (
          <span
            className="kh-ops-capacity-marker"
            data-marker="100"
            style={{ left: `${stack.markerPct}%` }}
            aria-hidden="true"
          >
            <span>{t('marker100')}</span>
          </span>
        ) : null}
      </div>
      <div className="kh-ops-capacity-tip" aria-hidden="true">
        <dl>
          {rows.map((row) => (
            <div key={row.key}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
