import { formatAiBillingMonthLabel, formatAiCostDayLabel } from '@project-knowledge-hub/domain';

/** Locale label for a month (YYYY-MM) or a day / week start (YYYY-MM-DD). */
export function formatAiBillingMonth(period: string, locale: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(period)) return formatAiCostDayLabel(period, locale);
  return formatAiBillingMonthLabel(period, locale);
}

const LOCALE_TAGS: Record<string, string> = {
  en: 'en-US',
  de: 'de-DE',
  hu: 'hu-HU',
};

export function formatServiceDate(value: string | null, locale: string): string {
  if (!value) return '—';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const tag = LOCALE_TAGS[locale.toLowerCase()] ?? locale;
  return new Intl.DateTimeFormat(tag, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day)));
}
