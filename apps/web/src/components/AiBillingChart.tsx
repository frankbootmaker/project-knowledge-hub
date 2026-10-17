'use client';

export type AiBillingPeriodPoint = {
  period: string;
  paidCost: number;
  subscription: number;
  planChange: number;
  onDemand: number;
  legacyToken: number;
  theoreticalApiCost: number;
};

/**
 * Paid AI cost stacked by type, with the theoretical API cost as a line.
 * A negative plan change is drawn below the axis.
 */
export function AiBillingChart({
  periods,
  ariaLabel,
}: {
  periods: AiBillingPeriodPoint[];
  ariaLabel: string;
}) {
  const width = 640;
  const height = 220;
  const pad = { top: 16, right: 12, bottom: 28, left: 44 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const rows = periods.slice().sort((a, b) => a.period.localeCompare(b.period));
  if (rows.length === 0) return null;

  const positiveOf = (row: AiBillingPeriodPoint) =>
    Math.max(0, row.subscription) +
    Math.max(0, row.planChange) +
    Math.max(0, row.onDemand) +
    Math.max(0, row.legacyToken);
  const negativeOf = (row: AiBillingPeriodPoint) =>
    Math.min(0, row.planChange) +
    Math.min(0, row.subscription) +
    Math.min(0, row.onDemand);
  const max = Math.max(
    1,
    ...rows.map((row) => Math.max(positiveOf(row), row.theoreticalApiCost)),
  );
  const min = Math.min(0, ...rows.map(negativeOf));
  const span = max - min;
  const yFor = (value: number) =>
    pad.top + ((max - value) / span) * innerH;
  const zeroY = yFor(0);
  const slot = innerW / rows.length;
  const barW = Math.min(28, slot * 0.55);

  const line = rows
    .map((row, index) => {
      const x = pad.left + slot * index + slot / 2;
      const y = yFor(row.theoreticalApiCost);
      return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
    })
    .join(' ');

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="kh-ops-ai-cost-chart"
      role="img"
      aria-label={ariaLabel}
    >
      <line
        x1={pad.left}
        y1={pad.top}
        x2={pad.left}
        y2={pad.top + innerH}
        className="kh-ops-ai-cost-axis"
      />
      <line
        x1={pad.left}
        y1={zeroY}
        x2={pad.left + innerW}
        y2={zeroY}
        className="kh-ops-ai-cost-axis"
      />
      {rows.map((row, index) => {
        const x = pad.left + slot * index + (slot - barW) / 2;
        let cursor = 0;
        const parts = [
          { value: Math.max(0, row.subscription), className: 'kh-ops-ai-cost-sub' },
          { value: Math.max(0, row.planChange), className: 'kh-ops-ai-cost-change' },
          { value: Math.max(0, row.onDemand), className: 'kh-ops-ai-cost-demand' },
          { value: Math.max(0, row.legacyToken), className: 'kh-ops-ai-cost-legacy' },
        ];
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
            <text
              x={x + barW / 2}
              y={height - 8}
              textAnchor="middle"
              className="fill-ink-muted text-[10px]"
            >
              {row.period.slice(2)}
            </text>
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
  );
}
