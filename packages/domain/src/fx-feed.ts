import type { FxRate } from './fx.js';

export type FxFeedResponse = {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
};

export type FxFetcher = (url: string, init?: RequestInit) => Promise<FxFeedResponse>;

/** ECB euro foreign-exchange reference feed (about 90 days). */
export const ECB_EUROFX_90_URL =
  'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml';

/** ECB euro foreign-exchange reference feed (full history). */
export const ECB_EUROFX_FULL_URL =
  'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.xml';

/** Magyar Nemzeti Bank SOAP endpoint. Optional source for HUF quotes. */
export const MNB_EXCHANGE_RATE_URL = 'http://www.mnb.hu/arfolyamok.asmx';

const DAY_CUBE =
  /<Cube\b[^>]*\stime="(\d{4}-\d{2}-\d{2})"[^>]*>([\s\S]*?)<\/Cube>/g;
const CURRENCY_CUBE = /currency="([A-Z]{3})"\s+rate="([0-9]+(?:\.[0-9]+)?)"/g;

/** Parse ECB eurofxref XML into EUR-base quotes. Self-closing cubes only. */
export function parseEcbEuroFx(xml: string): FxRate[] {
  const rates: FxRate[] = [];
  for (const day of xml.matchAll(DAY_CUBE)) {
    const date = day[1];
    const body = day[2] ?? '';
    if (!date) continue;
    for (const quote of body.matchAll(CURRENCY_CUBE)) {
      const code = quote[1];
      const rate = Number(quote[2]);
      if (!code || !Number.isFinite(rate) || rate <= 0) continue;
      rates.push({ date, base: 'EUR', quote: code, rate, source: 'ecb' });
    }
  }
  return rates;
}

function unescapeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function attr(tag: string, name: string): string | null {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(tag);
  return match?.[1] ?? null;
}

function parseMnbNumber(raw: string): number {
  const normalized = raw.trim().replace(/\s/g, '').replace(',', '.');
  return Number(normalized);
}

/**
 * Parse MNB GetExchangeRates XML. The published figure is HUF for `unit`
 * of the foreign currency, so 1 unit of that currency equals figure/unit HUF.
 */
export function parseMnbRates(xml: string): FxRate[] {
  const text = unescapeXml(xml);
  const rates: FxRate[] = [];
  const dayRe = /<Day\b([^>]*)>([\s\S]*?)<\/Day>/g;
  const rateRe = /<Rate\b([^>]*)>([\d.,\s]+)<\/Rate>/g;
  for (const day of text.matchAll(dayRe)) {
    const date = attr(day[1] ?? '', 'date');
    const body = day[2] ?? '';
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    for (const rateTag of body.matchAll(rateRe)) {
      const attrs = rateTag[1] ?? '';
      const curr = attr(attrs, 'curr');
      const unit = Number(attr(attrs, 'unit') ?? '1');
      const figure = parseMnbNumber(rateTag[2] ?? '');
      if (!curr || !Number.isFinite(unit) || unit <= 0) continue;
      if (!Number.isFinite(figure) || figure <= 0) continue;
      rates.push({
        date,
        base: curr,
        quote: 'HUF',
        rate: figure / unit,
        source: 'mnb',
      });
    }
  }
  return rates;
}

export function mnbExchangeRatesRequest(from: string, to: string): {
  url: string;
  init: { method: 'POST'; headers: Record<string, string>; body: string };
} {
  const currencies = ['EUR', 'USD', 'GBP', 'CHF', 'PLN', 'CZK', 'RON', 'SEK', 'NOK', 'DKK', 'CAD', 'AUD', 'JPY'];
  const body = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <GetExchangeRates xmlns="http://www.mnb.hu/webservices/">
      <startDate>${from}</startDate>
      <endDate>${to}</endDate>
      <currencyNames>${currencies.join(',')}</currencyNames>
    </GetExchangeRates>
  </soap:Body>
</soap:Envelope>`;
  return {
    url: MNB_EXCHANGE_RATE_URL,
    init: {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        SOAPAction: 'http://www.mnb.hu/webservices/MNBArfolyamServiceSoap/GetExchangeRates',
      },
      body,
    },
  };
}

function isoToday(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function shiftIsoDate(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function inWindow(date: string, from?: string, to?: string): boolean {
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Download ECB euro reference rates and, unless skipped, MNB HUF quotes.
 * A network or HTTP failure is reported and does not throw.
 */
export async function loadReferenceRates(options: {
  fetchImpl: FxFetcher;
  from?: string;
  to?: string;
  includeMnb?: boolean;
  now?: Date;
}): Promise<{ rates: FxRate[]; errors: string[] }> {
  const now = options.now ?? new Date();
  const to = options.to ?? isoToday(now);
  const from = options.from ?? shiftIsoDate(to, -10);
  const errors: string[] = [];
  const rates: FxRate[] = [];
  const ecbUrl =
    from < shiftIsoDate(to, -90) ? ECB_EUROFX_FULL_URL : ECB_EUROFX_90_URL;
  try {
    const response = await options.fetchImpl(ecbUrl);
    if (!response.ok) throw new Error(`ECB HTTP ${response.status}`);
    const xml = await response.text();
    for (const rate of parseEcbEuroFx(xml)) {
      if (inWindow(rate.date, from, to)) rates.push(rate);
    }
  } catch (error) {
    errors.push(messageOf(error));
  }
  if (options.includeMnb !== false) {
    try {
      const request = mnbExchangeRatesRequest(from, to);
      const response = await options.fetchImpl(request.url, request.init);
      if (!response.ok) throw new Error(`MNB HTTP ${response.status}`);
      const xml = await response.text();
      for (const rate of parseMnbRates(xml)) {
        if (inWindow(rate.date, from, to)) rates.push(rate);
      }
    } catch (error) {
      errors.push(messageOf(error));
    }
  }
  return { rates, errors };
}
