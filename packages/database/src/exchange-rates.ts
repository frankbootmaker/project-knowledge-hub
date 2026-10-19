import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import {
  AppError,
  loadReferenceRates,
  type FxFetcher,
  type FxRate,
} from '@project-knowledge-hub/domain';
import type { Database } from './index.js';
import { exchangeRates } from './schema/index.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const CODE = /^[A-Z]{3}$/;

function shiftIsoDate(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function weekdayOnOrBefore(iso: string): string {
  const date = new Date(`${iso}T00:00:00.000Z`);
  while (date.getUTCDay() === 0 || date.getUTCDay() === 6) {
    date.setUTCDate(date.getUTCDate() - 1);
  }
  return date.toISOString().slice(0, 10);
}

function previousWeekday(iso: string): string {
  const date = new Date(`${iso}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  while (date.getUTCDay() === 0 || date.getUTCDay() === 6) {
    date.setUTCDate(date.getUTCDate() - 1);
  }
  return date.toISOString().slice(0, 10);
}

function toFxRate(row: {
  rateDate: string;
  base: string;
  quote: string;
  rate: number | string;
  source: string;
}): FxRate {
  return {
    date: row.rateDate,
    base: row.base,
    quote: row.quote,
    rate: Number(row.rate),
    source: row.source,
  };
}

export async function upsertExchangeRates(
  database: Database,
  rates: readonly FxRate[],
): Promise<number> {
  const rows = rates.filter(
    (rate) =>
      ISO_DATE.test(rate.date) &&
      CODE.test(rate.base) &&
      CODE.test(rate.quote) &&
      rate.base !== rate.quote &&
      Number.isFinite(rate.rate) &&
      rate.rate > 0 &&
      (rate.source === 'ecb' || rate.source === 'mnb' || rate.source === 'manual'),
  );
  const chunkSize = 200;
  for (let index = 0; index < rows.length; index += chunkSize) {
    const chunk = rows.slice(index, index + chunkSize).map((rate) => ({
      rateDate: rate.date,
      base: rate.base,
      quote: rate.quote,
      rate: rate.rate,
      source: rate.source,
      updatedAt: new Date(),
    }));
    if (chunk.length === 0) continue;
    await database.db
      .insert(exchangeRates)
      .values(chunk)
      .onConflictDoUpdate({
        target: [
          exchangeRates.rateDate,
          exchangeRates.base,
          exchangeRates.quote,
          exchangeRates.source,
        ],
        set: {
          rate: sql`excluded.rate`,
          updatedAt: new Date(),
        },
      });
  }
  return rows.length;
}

export async function saveManualExchangeRate(
  database: Database,
  input: { date: string; base: string; quote: string; rate: number },
): Promise<FxRate> {
  const date = input.date.trim();
  const base = input.base.trim().toUpperCase();
  const quote = input.quote.trim().toUpperCase();
  if (!ISO_DATE.test(date) || !CODE.test(base) || !CODE.test(quote) || base === quote) {
    throw new AppError({
      code: 'FX_RATE_INVALID',
      message: 'A manual rate needs a date and two different currency codes',
      statusCode: 400,
    });
  }
  if (!Number.isFinite(input.rate) || input.rate <= 0) {
    throw new AppError({
      code: 'FX_RATE_INVALID',
      message: 'A manual rate must be a positive number',
      statusCode: 400,
    });
  }
  const rate: FxRate = { date, base, quote, rate: input.rate, source: 'manual' };
  await upsertExchangeRates(database, [rate]);
  return rate;
}

export async function listExchangeRates(
  database: Database,
  from: string,
  to: string,
): Promise<FxRate[]> {
  const rows = await database.db
    .select()
    .from(exchangeRates)
    .where(and(gte(exchangeRates.rateDate, from), lte(exchangeRates.rateDate, to)))
    .orderBy(desc(exchangeRates.rateDate), exchangeRates.base, exchangeRates.quote);
  return rows.map(toFxRate);
}

async function latestEurOnOrBefore(
  database: Database,
  onDate: string,
): Promise<string | null> {
  const [row] = await database.db
    .select({ rateDate: exchangeRates.rateDate })
    .from(exchangeRates)
    .where(and(eq(exchangeRates.base, 'EUR'), lte(exchangeRates.rateDate, onDate)))
    .orderBy(desc(exchangeRates.rateDate))
    .limit(1);
  return row?.rateDate ?? null;
}

/**
 * Import ECB (and MNB) quotes when the book does not already cover `dates`.
 * Without a fetcher, or when the fetch fails, the stored book is left as it is.
 */
export async function ensureExchangeRates(
  database: Database,
  dates: readonly string[],
  fetchImpl?: FxFetcher,
  now = new Date(),
): Promise<{ imported: number; error?: string }> {
  if (!fetchImpl || dates.length === 0) return { imported: 0 };
  const valid = dates.filter((date) => ISO_DATE.test(date)).sort();
  const earliest = valid[0];
  const latest = valid[valid.length - 1];
  if (!earliest || !latest) return { imported: 0 };
  const today = now.toISOString().slice(0, 10);
  const cap = latest < today ? latest : today;
  const target = weekdayOnOrBefore(cap);
  const acceptable = cap >= today ? previousWeekday(target) : target;
  const early = await latestEurOnOrBefore(database, earliest);
  const fresh = await latestEurOnOrBefore(database, cap);
  if (early && fresh && fresh >= acceptable) return { imported: 0 };
  const loaded = await loadReferenceRates({
    fetchImpl,
    from: earliest,
    to: cap,
    now,
  });
  const imported = await upsertExchangeRates(database, loaded.rates);
  return {
    imported,
    ...(loaded.errors.length > 0 ? { error: loaded.errors.join('; ') } : {}),
  };
}

/** Rates inside the date window, plus the latest earlier quote of each pair. */
export async function loadExchangeRateBook(
  database: Database,
  dates: readonly string[],
): Promise<FxRate[]> {
  const valid = dates.filter((date) => ISO_DATE.test(date)).sort();
  const min = valid[0];
  const max = valid[valid.length - 1];
  if (!min || !max) return [];
  const floor = shiftIsoDate(min, -14);
  const rows = await database.db
    .select()
    .from(exchangeRates)
    .where(and(gte(exchangeRates.rateDate, floor), lte(exchangeRates.rateDate, max)));
  const prior = await database.db.execute<{
    rate_date: string;
    base: string;
    quote: string;
    rate: string | number;
    source: string;
  }>(sql`
    SELECT DISTINCT ON (base, quote, source)
      rate_date, base, quote, rate, source
    FROM exchange_rates
    WHERE rate_date < ${floor}
    ORDER BY base, quote, source, rate_date DESC
  `);
  const book = rows.map(toFxRate);
  const priorRows = Array.isArray(prior) ? prior : [];
  for (const row of priorRows) {
    const date = String(row.rate_date).slice(0, 10);
    book.push({
      date,
      base: row.base,
      quote: row.quote,
      rate: Number(row.rate),
      source: row.source,
    });
  }
  return book;
}
