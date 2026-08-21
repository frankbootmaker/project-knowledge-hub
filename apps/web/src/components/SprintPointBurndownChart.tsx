'use client';

import { useId, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';

export type PointBurndownRow = {
  date: string;
  idealRemaining: number;
  remaining: number;
};

/** Compact ? control that reveals chart legend text on click. */
export function BurndownLegendHelp() {
  const t = useTranslations('delivery');
  const legendId = useId();
  const [open, setOpen] = useState(false);

  return (
    <div className="grid justify-items-end gap-2">
      <button
        type="button"
        className="kh-ops-help-btn"
        aria-expanded={open}
        aria-controls={legendId}
        aria-label={t('scrumBurndownHelp')}
        title={t('scrumBurndownHelp')}
        onClick={() => setOpen((current) => !current)}
      >
        ?
      </button>
      {open ? (
        <p
          id={legendId}
          role="note"
          className="kh-ops-inset m-0 max-w-md text-left text-xs text-ink-muted"
        >
          {t('scrumBurndownLegend')}
        </p>
      ) : null}
    </div>
  );
}

export function SprintPointBurndownChart({
  committedPoints,
  startDate,
  endDate,
  points,
}: {
  committedPoints: number;
  startDate: string | null;
  endDate: string | null;
  points: PointBurndownRow[];
}) {
  const t = useTranslations('delivery');
  const width = 560;
  const height = 180;
  const pad = { top: 12, right: 12, bottom: 28, left: 44 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;

  const geometry = useMemo(() => {
    if (
      committedPoints <= 0 ||
      !startDate ||
      !endDate ||
      points.length === 0
    ) {
      return null;
    }
    const start = Date.parse(`${startDate}T00:00:00Z`);
    const end = Date.parse(`${endDate}T00:00:00Z`);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      return null;
    }
    const xFor = (ymd: string) => {
      const tMs = Date.parse(`${ymd}T00:00:00Z`);
      const ratio = Math.min(1, Math.max(0, (tMs - start) / (end - start)));
      return pad.left + ratio * innerW;
    };
    const yFor = (remaining: number) =>
      pad.top +
      (1 - Math.min(1, Math.max(0, remaining / committedPoints))) * innerH;

    const ideal = [
      { x: pad.left, y: yFor(committedPoints) },
      { x: pad.left + innerW, y: yFor(0) },
    ];
    const actual = points
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((row) => ({
        x: xFor(row.date),
        y: yFor(row.remaining),
      }));
    return { ideal, actual };
  }, [committedPoints, startDate, endDate, points, innerH, innerW, pad.left, pad.top]);

  if (!geometry) {
    return <p className="m-0 text-sm text-ink-muted">{t('scrumBurndownEmpty')}</p>;
  }

  const idealPath = `M ${geometry.ideal[0]!.x} ${geometry.ideal[0]!.y} L ${geometry.ideal[1]!.x} ${geometry.ideal[1]!.y}`;
  const actualPath =
    geometry.actual.length > 0
      ? geometry.actual
          .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
          .join(' ')
      : null;

  return (
    <div className="grid gap-2">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full max-w-full"
        role="img"
        aria-label={t('scrumBurndownAria')}
      >
        <line
          x1={pad.left}
          y1={pad.top}
          x2={pad.left}
          y2={pad.top + innerH}
          stroke="currentColor"
          className="text-line"
        />
        <line
          x1={pad.left}
          y1={pad.top + innerH}
          x2={pad.left + innerW}
          y2={pad.top + innerH}
          stroke="currentColor"
          className="text-line"
        />
        <path
          d={idealPath}
          fill="none"
          stroke="currentColor"
          strokeDasharray="4 4"
          className="text-ink-muted"
          strokeWidth={1.5}
        />
        {actualPath ? (
          <path
            d={actualPath}
            fill="none"
            stroke="currentColor"
            className="text-brand"
            strokeWidth={2}
          />
        ) : null}
        <text
          x={pad.left}
          y={height - 8}
          className="fill-ink-muted text-[10px]"
        >
          {startDate}
        </text>
        <text
          x={pad.left + innerW}
          y={height - 8}
          textAnchor="end"
          className="fill-ink-muted text-[10px]"
        >
          {endDate}
        </text>
        <text
          x={4}
          y={pad.top + 4}
          className="fill-ink-muted text-[10px]"
        >
          {committedPoints}
        </text>
      </svg>
    </div>
  );
}
