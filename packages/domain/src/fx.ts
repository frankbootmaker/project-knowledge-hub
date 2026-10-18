import { roundAiMoney } from './ai-billing.js';

/**
 * Foreign exchange for AI cost. ECB rates are stored as 1 EUR = `rate` quote.
 * A missing day uses the latest earlier quote. Callers pass the rate book;
 * this module does not fetch.
 */

export type FxRate = {
  /** YYYY-MM-DD */
  date: string;
  /** 1 unit of `base` equals `rate` units of `quote`. */
  base: string;
  quote: string;
  rate: number;
  /** ecb | mnb | manual | identity */
  source: string;
};

export type FxConversion = {
  originalAmount: number;
  originalCurrency: string;
  amount: number;
  currency: string;
  /** originalAmount * rate ≈ amount, before the final cent rounding. */
  rate: number | null;
  /** Quote date used. Earlier than the requested day when that day is missing. */
  rateDate: string | null;
  source: string | null;
};

const ISO_DATE = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const ISO_MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function isoDateOnly(value: string | Date | null | undefined): string | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }
  const trimmed = value.trim();
  if (ISO_DATE.test(trimmed)) return trimmed;
  if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) {
    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString().slice(0, 10);
  }
  return null;
}

/** Paid entries convert on paid-at, or the service start when paid-at is missing. */
export function paidConversionDate(input: {
  paidAt?: string | Date | null;
  servicePeriodStart?: string | null;
  period: string;
}): string {
  const paid = isoDateOnly(input.paidAt ?? null);
  if (paid) return paid;
  const service = input.servicePeriodStart?.trim() ?? '';
  if (ISO_DATE.test(service)) return service;
  if (ISO_MONTH.test(input.period)) return `${input.period}-01`;
  return input.period;
}

/** Theoretical cost converts on the usage date, or the first day of the usage month. */
export function usageConversionDate(input: {
  usageOccurredAt?: string | Date | null;
  period?: string | null;
  fallback: string;
}): string {
  const occurred = isoDateOnly(input.usageOccurredAt ?? null);
  if (occurred) return occurred;
  const period = input.period?.trim() ?? '';
  if (ISO_MONTH.test(period)) return `${period}-01`;
  return input.fallback;
}

/**
 * Quote date for theoretical API cost: usage time, else completion, else the
 * task's last update, else the usage month.
 */
export function theoreticalUsageDate(input: {
  usageOccurredAt?: string | Date | null;
  completedAt?: string | Date | null;
  updatedAt?: string | Date | null;
  period?: string | null;
  fallback: string;
}): string {
  const occurred = isoDateOnly(input.usageOccurredAt ?? null);
  if (occurred) return occurred;
  const completed = isoDateOnly(input.completedAt ?? null);
  if (completed) return completed;
  const updated = isoDateOnly(input.updatedAt ?? null);
  if (updated) return updated;
  return usageConversionDate({
    usageOccurredAt: null,
    period: input.period,
    fallback: input.fallback,
  });
}

function sourceRank(source: string, base: string, quote: string): number {
  if (source === 'manual') return 30;
  if (source === 'mnb' && (base === 'HUF' || quote === 'HUF')) return 20;
  if (source === 'ecb') return 10;
  if (source === 'mnb') return 8;
  return 0;
}

/** Latest quote on or before `onDate`. Manual wins that day; MNB wins HUF ties. */
export function lookupFxRate(
  rates: readonly FxRate[],
  base: string,
  quote: string,
  onDate: string,
): FxRate | null {
  let best: FxRate | null = null;
  for (const rate of rates) {
    if (rate.base !== base || rate.quote !== quote) continue;
    if (rate.date > onDate) continue;
    if (!Number.isFinite(rate.rate) || rate.rate <= 0) continue;
    if (!best || rate.date > best.date) {
      best = rate;
      continue;
    }
    if (rate.date < best.date) continue;
    if (sourceRank(rate.source, base, quote) > sourceRank(best.source, base, quote)) {
      best = rate;
    }
  }
  return best;
}

type FxLeg = {
  rate: number;
  rateDate: string;
  source: string;
};

function directLeg(
  rates: readonly FxRate[],
  from: string,
  to: string,
  onDate: string,
): FxLeg | null {
  const direct = lookupFxRate(rates, from, to, onDate);
  if (direct) {
    return { rate: direct.rate, rateDate: direct.date, source: direct.source };
  }
  const inverse = lookupFxRate(rates, to, from, onDate);
  if (!inverse) return null;
  return { rate: 1 / inverse.rate, rateDate: inverse.date, source: inverse.source };
}

function preferSource(left: string, right: string): string {
  if (left === right) return left;
  if (left === 'manual' || right === 'manual') return 'manual';
  if (left === 'mnb' || right === 'mnb') return 'mnb';
  return left;
}

function legViaEur(
  rates: readonly FxRate[],
  from: string,
  to: string,
  onDate: string,
): FxLeg | null {
  if (from === 'EUR' || to === 'EUR') return null;
  const intoEur = directLeg(rates, from, 'EUR', onDate);
  const outOfEur = directLeg(rates, 'EUR', to, onDate);
  if (!intoEur || !outOfEur) return null;
  return {
    rate: intoEur.rate * outOfEur.rate,
    rateDate: intoEur.rateDate < outOfEur.rateDate ? intoEur.rateDate : outOfEur.rateDate,
    source: preferSource(intoEur.source, outOfEur.source),
  };
}

function conversionLeg(
  rates: readonly FxRate[],
  from: string,
  to: string,
  onDate: string,
): FxLeg | null {
  return directLeg(rates, from, to, onDate) ?? legViaEur(rates, from, to, onDate);
}

export function convertMoney(
  amount: number,
  from: string,
  to: string,
  onDate: string,
  rates: readonly FxRate[],
): FxConversion {
  const originalAmount = roundAiMoney(amount);
  if (from === to) {
    return {
      originalAmount,
      originalCurrency: from,
      amount: originalAmount,
      currency: to,
      rate: 1,
      rateDate: onDate,
      source: 'identity',
    };
  }
  const leg = conversionLeg(rates, from, to, onDate);
  if (!leg) {
    return {
      originalAmount,
      originalCurrency: from,
      amount: originalAmount,
      currency: from,
      rate: null,
      rateDate: null,
      source: null,
    };
  }
  return {
    originalAmount,
    originalCurrency: from,
    amount: roundAiMoney(originalAmount * leg.rate),
    currency: to,
    rate: leg.rate,
    rateDate: leg.rateDate,
    source: leg.source,
  };
}

/**
 * Split `total` by signed weights. The result sums to `roundAiMoney(total)`.
 * A zero weight-sum returns zeros.
 */
export function splitSignedMoney(total: number, parts: readonly number[]): number[] {
  const count = parts.length;
  if (count === 0) return [];
  const target = Math.round(roundAiMoney(total) * 100);
  const weightSum = parts.reduce((sum, part) => sum + part, 0);
  if (!Number.isFinite(weightSum) || Math.round(weightSum * 100) === 0) {
    return parts.map(() => 0);
  }
  const raw = parts.map((part) => (target * part) / weightSum);
  const bases = raw.map((value) => Math.trunc(value));
  const leftover = target - bases.reduce((sum, value) => sum + value, 0);
  const direction = leftover < 0 ? -1 : 1;
  let remaining = Math.abs(leftover);
  const order = raw
    .map((value, index) => ({
      index,
      frac: Math.abs(value - Math.trunc(value)),
    }))
    .sort((left, right) => right.frac - left.frac || left.index - right.index);
  for (let step = 0; remaining > 0 && order.length > 0; step += 1) {
    const slot = order[step % order.length];
    if (!slot) break;
    bases[slot.index] = (bases[slot.index] ?? 0) + direction;
    remaining -= 1;
  }
  return bases.map((cents) => cents / 100);
}

/**
 * Convert parts that must keep their ratios. Rounded parts sum to the
 * rounded conversion of their sum.
 */
export function convertMoneyParts(
  parts: readonly number[],
  from: string,
  to: string,
  onDate: string,
  rates: readonly FxRate[],
): { amounts: number[]; conversion: FxConversion } {
  const total = roundAiMoney(parts.reduce((sum, part) => sum + part, 0));
  const conversion = convertMoney(total, from, to, onDate, rates);
  if (conversion.currency !== to) {
    return {
      amounts: parts.map((part) => roundAiMoney(part)),
      conversion,
    };
  }
  return {
    amounts: splitSignedMoney(conversion.amount, parts),
    conversion,
  };
}
