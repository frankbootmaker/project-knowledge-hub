/** Geometry for a stacked burn + planned bar measured against capacity. */

export type UtilizationBand = 'under' | 'on_track' | 'over' | 'unknown';

export type CapacityStack = {
  burnHours: number;
  plannedHours: number;
  totalHours: number;
  capacityHours: number | null;
  /** Burn + planned as a percent of capacity, one decimal. Null without capacity. */
  totalPct: number | null;
  /** Burned segment width, percent of the track. */
  burnWidthPct: number;
  /** Planned segment starts here so the two segments share an edge. */
  plannedLeftPct: number;
  plannedWidthPct: number;
  overflow: boolean;
  /** 100% capacity mark on the track. Present only when the stack overflows. */
  markerPct: number | null;
  overflowWidthPct: number;
  band: UtilizationBand;
};

const TRACK_DECIMALS = 10_000;

function roundHours(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundPct(value: number): number {
  return Math.round(value * 10) / 10;
}

function trackPct(part: number, scale: number): number {
  if (scale <= 0 || part <= 0) return 0;
  return Math.round((part / scale) * 100 * TRACK_DECIMALS) / TRACK_DECIMALS;
}

/** Same bands as API `utilizationStatus`: under 70, on track through 110, else over. */
export function utilizationBand(pct: number | null): UtilizationBand {
  if (pct == null || !Number.isFinite(pct)) return 'unknown';
  if (pct < 70) return 'under';
  if (pct <= 110) return 'on_track';
  return 'over';
}

export function formatHours(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${value.toFixed(1)}h`;
}

export function formatStackPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${value.toFixed(1)}%`;
}

export function capacityStack(input: {
  burnHours: number;
  plannedHours: number;
  capacityHours: number | null;
}): CapacityStack {
  const burnHours = roundHours(Number.isFinite(input.burnHours) ? Math.max(0, input.burnHours) : 0);
  const plannedHours = roundHours(
    Number.isFinite(input.plannedHours) ? Math.max(0, input.plannedHours) : 0,
  );
  const totalHours = roundHours(burnHours + plannedHours);
  const rawCapacity = input.capacityHours;
  const capacityHours =
    rawCapacity != null && Number.isFinite(rawCapacity) && rawCapacity > 0 ? rawCapacity : null;

  if (capacityHours == null) {
    const scale = Math.max(totalHours, 1);
    const burnWidthPct = trackPct(burnHours, scale);
    return {
      burnHours,
      plannedHours,
      totalHours,
      capacityHours: null,
      totalPct: null,
      burnWidthPct,
      plannedLeftPct: burnWidthPct,
      plannedWidthPct: trackPct(plannedHours, scale),
      overflow: false,
      markerPct: null,
      overflowWidthPct: 0,
      band: 'unknown',
    };
  }

  const totalPct = roundPct((totalHours / capacityHours) * 100);
  const overflow = totalHours > capacityHours;
  const scale = Math.max(capacityHours, totalHours);
  const burnWidthPct = trackPct(burnHours, scale);
  return {
    burnHours,
    plannedHours,
    totalHours,
    capacityHours,
    totalPct,
    burnWidthPct,
    plannedLeftPct: burnWidthPct,
    plannedWidthPct: trackPct(plannedHours, scale),
    overflow,
    markerPct: overflow ? trackPct(capacityHours, scale) : null,
    overflowWidthPct: overflow ? trackPct(totalHours - capacityHours, scale) : 0,
    band: utilizationBand(totalPct),
  };
}

type StackTranslator = (key: string, values?: Record<string, string | number>) => string;

export function stackSummary(t: StackTranslator, name: string, stack: CapacityStack): string {
  const values = {
    name,
    burn: formatHours(stack.burnHours),
    planned: formatHours(stack.plannedHours),
    total: formatHours(stack.totalHours),
    pct: formatStackPct(stack.totalPct),
    capacity: formatHours(stack.capacityHours),
  };
  if (stack.capacityHours == null) return t('barSummaryUnknown', values);
  if (stack.overflow) return t('barSummaryOver', values);
  return t('barSummary', values);
}
