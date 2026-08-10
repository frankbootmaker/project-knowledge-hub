export const PROJECT_CURRENCIES = [
  'EUR',
  'USD',
  'GBP',
  'CHF',
  'HUF',
  'PLN',
  'CZK',
  'RON',
  'SEK',
  'NOK',
  'DKK',
  'CAD',
  'AUD',
  'JPY',
] as const;

export type ProjectCurrencyCode = (typeof PROJECT_CURRENCIES)[number];

/** Map app locales to Intl tags so SSR and client format the same way. */
const LOCALE_TAGS: Record<string, string> = {
  en: 'en-US',
  de: 'de-DE',
  hu: 'hu-HU',
};

export function formatMoney(
  amount: number | null | undefined,
  currency: string,
  locale = 'en',
): string {
  if (amount == null || !Number.isFinite(amount)) return '—';
  const tag = LOCALE_TAGS[locale] ?? 'en-US';
  try {
    return new Intl.NumberFormat(tag, {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

export function parseOptionalNumber(
  value: string,
): number | null | undefined {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return undefined;
  return n;
}
