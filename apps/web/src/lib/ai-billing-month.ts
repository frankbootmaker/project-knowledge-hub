import { formatAiBillingMonthLabel } from '@project-knowledge-hub/domain';

/** Locale month label shared by the chart, tooltips, and monthly overview. */
export function formatAiBillingMonth(period: string, locale: string): string {
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
