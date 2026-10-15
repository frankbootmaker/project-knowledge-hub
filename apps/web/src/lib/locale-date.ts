/**
 * Shared locale dates. Calendar days (YYYY-MM-DD) stay on that day.
 * Timestamps use the viewer's local zone after the stable first paint.
 */

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isCalendarDate(value: string): boolean {
  return CALENDAR_DATE.test(value.trim());
}

function utcParts(value: string): { dd: string; mm: string; yyyy: string } | null {
  const calendar = CALENDAR_DATE.exec(value.trim());
  if (calendar) {
    return { yyyy: calendar[1]!, mm: calendar[2]!, dd: calendar[3]! };
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return {
    dd: String(date.getUTCDate()).padStart(2, '0'),
    mm: String(date.getUTCMonth() + 1).padStart(2, '0'),
    yyyy: String(date.getUTCFullYear()),
  };
}

/** Stable UTC label for SSR + first client paint (no Intl padding quirks). */
export function formatStableDate(value: string): string {
  const parts = utcParts(value);
  if (!parts) return value;
  return `${parts.dd}/${parts.mm}/${parts.yyyy}`;
}

/** Stable UTC date-time for SSR + first client paint. */
export function formatStableDateTime(value: string): string {
  if (isCalendarDate(value)) return formatStableDate(value);
  const parts = utcParts(value);
  if (!parts) return value;
  const date = new Date(value);
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mi = String(date.getUTCMinutes()).padStart(2, '0');
  const ss = String(date.getUTCSeconds()).padStart(2, '0');
  return `${parts.dd}/${parts.mm}/${parts.yyyy}, ${hh}:${mi}:${ss}`;
}

function calendarUtc(value: string): Date | null {
  const match = CALENDAR_DATE.exec(value.trim());
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.getTime()) ? null : date;
}

const DATE_PARTS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
};

/**
 * Locale date. YYYY-MM-DD is a calendar day (UTC, no zone shift).
 * Anything else is a timestamp shown in the viewer's local zone.
 */
export function formatLocaleDate(value: string, locale: string): string {
  if (isCalendarDate(value)) {
    const date = calendarUtc(value);
    if (!date) return value;
    return new Intl.DateTimeFormat(locale, { ...DATE_PARTS, timeZone: 'UTC' }).format(date);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, DATE_PARTS).format(date);
}

/** Locale date and time for a timestamp. Calendar days stay date-only. */
export function formatLocaleDateTime(value: string, locale: string): string {
  if (isCalendarDate(value)) return formatLocaleDate(value, locale);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, {
    ...DATE_PARTS,
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}
