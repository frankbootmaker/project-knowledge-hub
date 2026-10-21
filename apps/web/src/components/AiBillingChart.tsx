'use client';

import { useId, useState } from 'react';
import { summarizeAiBillingMonth } from '@project-knowledge-hub/domain';
import { formatMoney } from '../lib/project-currency';
import { formatAiBillingMonth } from '../lib/ai-billing-month';

export type AiBillingPeriodPoint = {
  period: string;
  paidCost: number;
  subscription: number;
  planChange: number;
  onDemand: number;
  legacyToken: number;
  theoreticalApiCost: number;
  difference?: number;
  ratio?: number | null;
  scheduled?: boolean;
};

export type AiBillingChartLabels = {
  subscription: string;
  planChange: string;
  onDemand: string;
  paid: string;
  theoretical: string;
  difference: string;
  ratio: string;
  scheduled: string;
};

const WIDTH = 760;
const HEIGHT = 248;

function seriesValue(
  row: AiBillingPeriodPoint,
  key: 'subscription' | 'planChange' | 'onDemand' | 'theoreticalApiCost',
): number {
  return row[key];
}

export function aiCostSeriesEmpty(
  periods: readonly AiBillingPeriodPoint[],
  key: 'subscription' | 'planChange' | 'onDemand' | 'theoreticalApiCost',
): boolean {
  return periods.every((row) => seriesValue(row, key) === 0);
}

function monthFigures(row: AiBillingPeriodPoint) {
  if (
    row.difference != null &&
    (row.ratio !== undefined)
  ) {
    return {
      paidCost: row.paidCost,
      difference: row.difference,
      ratio: row.ratio,
    };
  }
  const summary = summarizeAiBillingMonth({
    period: row.period,
    currency: 'USD',
    subscription: row.subscription,
    planChange: row.planChange,
    onDemand: row.onDemand,
    theoreticalApiCost: row.theoreticalApiCost,
  });
  return {
    paidCost: summary.paidCost,
    difference: summary.difference,
    ratio: summary.ratio,
  };
}

function niceStep(span: number): number {
  const rough = Math.max(span, 1) / 4;
  const power = 10 ** Math.floor(Math.log10(rough));
  const error = rough / power;
  if (error >= 7.5) return 10 * power;
  if (error >= 3.5) return 5 * power;
  if (error >= 1.5) return 2 * power;
  return power;
}

function axisTicks(min: number, max: number): number[] {
  const step = niceStep(max - min);
  const start = Math.ceil((min - step * 0.001) / step) * step;
  const ticks: number[] = [];
  for (let value = start; value <= max + step * 0.001 && ticks.length < 6; value += step) {
    const rounded = Math.round(value * 100) / 100;
    ticks.push(rounded === 0 ? 0 : rounded);
  }
  if (min <= 0 && max >= 0 && !ticks.some((tick) => tick === 0)) ticks.push(0);
  return ticks.sort((a, b) => a - b);
}

export function AiBillingChartLegend({
  periods,
  labels,
}: {
  periods: readonly AiBillingPeriodPoint[];
  labels: Pick<AiBillingChartLabels, 'subscription' | 'planChange' | 'onDemand' | 'theoretical'>;
}) {
  const items = [
    { key: 'subscription' as const, className: 'kh-ops-ai-cost-sub', label: labels.subscription },
    { key: 'planChange' as const, className: 'kh-ops-ai-cost-change', label: labels.planChange },
    { key: 'onDemand' as const, className: 'kh-ops-ai-cost-demand', label: labels.onDemand },
    {
      key: 'theoreticalApiCost' as const,
      className: 'kh-ops-ai-cost-line',
      label: labels.theoretical,
    },
  ];
  return (
    <div className="kh-ops-chart-legend">
      {items.map((item) => {
        const empty = aiCostSeriesEmpty(periods, item.key);
        return (
          <span key={item.key} data-empty={empty ? 'true' : 'false'}>
            <i className={item.className} />
            {item.label}
          </span>
        );
      })}
    </div>
  );
}

/**
 * Paid AI cost stacked by type, with the theoretical API cost as a line.
 * A negative plan change is drawn below the axis.
 */
export function AiBillingChart({
  periods,
  ariaLabel,
  locale,
  currency,
  labels,
  ratioDigits = 3,
  showValueLabels,
  onActivate,
}: {
  periods: AiBillingPeriodPoint[];
  ariaLabel: string;
  locale: string;
  currency: string;
  labels: AiBillingChartLabels;
  ratioDigits?: number;
  showValueLabels?: boolean;
  onActivate?: (period: string) => void;
}) {
  const tipId = useId();
  const [active, setActive] = useState<number | null>(null);
  const height = HEIGHT;
  const pad = { top: 22, right: 16, bottom: 42, left: 78 };
  const innerW = WIDTH - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const rows = periods.slice().sort((a, b) => a.period.localeCompare(b.period));
  if (rows.length === 0) return null;
  const labelsOn = showValueLabels ?? rows.length <= 8;

  const positiveOf = (row: AiBillingPeriodPoint) =>
    Math.max(0, row.subscription) +
    Math.max(0, row.planChange) +
    Math.max(0, row.onDemand) +
    Math.max(0, row.legacyToken);
  const negativeOf = (row: AiBillingPeriodPoint) =>
    Math.min(0, row.planChange) + Math.min(0, row.subscription) + Math.min(0, row.onDemand);
  const max = Math.max(1, ...rows.map((row) => Math.max(positiveOf(row), row.theoreticalApiCost)));
  const min = Math.min(0, ...rows.map(negativeOf));
  const span = max - min || 1;
  const yFor = (value: number) => pad.top + ((max - value) / span) * innerH;
  const zeroY = yFor(0);
  const slot = innerW / rows.length;
  const barW = Math.min(28, slot * 0.55);
  const ticks = axisTicks(min, max);
  const money = (value: number) => formatMoney(value, currency, locale);
  const monthLabel = (period: string) => formatAiBillingMonth(period, locale);

  const line = rows
    .map((row, index) => {
      const x = pad.left + slot * index + slot / 2;
      const y = yFor(row.theoreticalApiCost);
      return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
    })
    .join(' ');

  const activeRow = active == null ? null : rows[active];
  const activeFigures = activeRow ? monthFigures(activeRow) : null;

  return (
    <div className="kh-ops-ai-cost-chart-frame">
      {activeRow && activeFigures && active != null ? (
        <div
          id={tipId}
          className="kh-ops-ai-cost-tip"
          role="tooltip"
          style={{ left: `${((pad.left + slot * active + slot / 2) / WIDTH) * 100}%` }}
        >
          <p className="kh-ops-ai-cost-tip-title">
            {monthLabel(activeRow.period)}
            {activeRow.scheduled ? ` · ${labels.scheduled}` : ''}
          </p>
          <dl>
            <div>
              <dt>{labels.subscription}</dt>
              <dd>{money(activeRow.subscription)}</dd>
            </div>
            <div>
              <dt>{labels.planChange}</dt>
              <dd>{money(activeRow.planChange)}</dd>
            </div>
            <div>
              <dt>{labels.onDemand}</dt>
              <dd>{money(activeRow.onDemand)}</dd>
            </div>
            <div>
              <dt>{labels.paid}</dt>
              <dd>{money(activeFigures.paidCost)}</dd>
            </div>
            <div>
              <dt>{labels.theoretical}</dt>
              <dd>{money(activeRow.theoreticalApiCost)}</dd>
            </div>
            <div>
              <dt>{labels.difference}</dt>
              <dd>{money(activeFigures.difference)}</dd>
            </div>
            <div>
              <dt>{labels.ratio}</dt>
              <dd>
                {activeFigures.ratio == null ? '—' : activeFigures.ratio.toFixed(ratioDigits)}
              </dd>
            </div>
          </dl>
        </div>
      ) : null}
      <svg
        viewBox={`0 0 ${WIDTH} ${height}`}
        className="kh-ops-ai-cost-chart"
        role="img"
        aria-label={ariaLabel}
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={pad.left}
              y1={yFor(tick)}
              x2={pad.left + innerW}
              y2={yFor(tick)}
              className={tick === 0 ? 'kh-ops-ai-cost-axis' : 'kh-ops-ai-cost-grid'}
            />
            <text
              x={pad.left - 6}
              y={yFor(tick) + 3}
              textAnchor="end"
              className="kh-ops-ai-cost-tick"
            >
              {money(tick)}
            </text>
          </g>
        ))}
        <line
          x1={pad.left}
          y1={pad.top}
          x2={pad.left}
          y2={pad.top + innerH}
          className="kh-ops-ai-cost-axis"
        />
        {rows.map((row, index) => {
          const x = pad.left + slot * index + (slot - barW) / 2;
          const center = pad.left + slot * index + slot / 2;
          let cursor = 0;
          const parts = [
            { value: Math.max(0, row.subscription), className: 'kh-ops-ai-cost-sub' },
            { value: Math.max(0, row.planChange), className: 'kh-ops-ai-cost-change' },
            { value: Math.max(0, row.onDemand), className: 'kh-ops-ai-cost-demand' },
            { value: Math.max(0, row.legacyToken), className: 'kh-ops-ai-cost-legacy' },
          ];
          const figures = monthFigures(row);
          const label = monthLabel(row.period);
          const described = [
            label,
            row.scheduled ? labels.scheduled : '',
            `${labels.subscription} ${money(row.subscription)}`,
            `${labels.planChange} ${money(row.planChange)}`,
            `${labels.onDemand} ${money(row.onDemand)}`,
            `${labels.paid} ${money(figures.paidCost)}`,
            `${labels.theoretical} ${money(row.theoreticalApiCost)}`,
            `${labels.difference} ${money(figures.difference)}`,
            `${labels.ratio} ${figures.ratio == null ? '—' : figures.ratio.toFixed(ratioDigits)}`,
          ]
            .filter(Boolean)
            .join(', ');
          return (
            <g key={row.period}>
              {parts.map((part) => {
                if (part.value <= 0) return null;
                const y = yFor(cursor + part.value);
                const h = yFor(cursor) - y;
                cursor += part.value;
                return (
                  <rect
                    key={part.className}
                    x={x}
                    y={y}
                    width={barW}
                    height={Math.max(0, h)}
                    className={part.className}
                  />
                );
              })}
              {row.planChange < 0 ? (
                <rect
                  x={x}
                  y={zeroY}
                  width={barW}
                  height={Math.max(0, yFor(row.planChange) - zeroY)}
                  className="kh-ops-ai-cost-credit"
                />
              ) : null}
              {labelsOn && figures.paidCost !== 0 ? (
                <text
                  x={center}
                  y={Math.max(12, yFor(Math.max(0, positiveOf(row))) - 4)}
                  textAnchor="middle"
                  className="kh-ops-ai-cost-value"
                >
                  {money(figures.paidCost)}
                </text>
              ) : null}
              <text
                x={center}
                y={height - (row.scheduled ? 18 : 10)}
                textAnchor="middle"
                className="kh-ops-ai-cost-month"
              >
                {label}
              </text>
              {row.scheduled ? (
                <text
                  x={center}
                  y={height - 6}
                  textAnchor="middle"
                  className="kh-ops-ai-cost-scheduled"
                >
                  {labels.scheduled}
                </text>
              ) : null}
              <rect
                x={pad.left + slot * index}
                y={pad.top}
                width={slot}
                height={innerH}
                className="kh-ops-ai-cost-hit"
                tabIndex={0}
                role="button"
                aria-label={described}
                aria-describedby={active === index ? tipId : undefined}
                onMouseEnter={() => setActive(index)}
                onMouseLeave={() => setActive((current) => (current === index ? null : current))}
                onFocus={() => setActive(index)}
                onBlur={() => setActive((current) => (current === index ? null : current))}
                onClick={() => onActivate?.(row.period)}
                onKeyDown={(event) => {
                  if (!onActivate) return;
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onActivate(row.period);
                  }
                }}
              />
            </g>
          );
        })}
        <path d={line} className="kh-ops-ai-cost-line" />
        {rows.map((row, index) => (
          <circle
            key={`${row.period}-dot`}
            cx={pad.left + slot * index + slot / 2}
            cy={yFor(row.theoreticalApiCost)}
            r={3}
            className="kh-ops-ai-cost-dot"
          />
        ))}
      </svg>
    </div>
  );
}
