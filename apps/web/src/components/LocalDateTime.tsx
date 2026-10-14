'use client';

import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import {
  formatLocaleDate,
  formatLocaleDateTime,
  formatStableDate,
  formatStableDateTime,
} from '../lib/locale-date';

/**
 * Format timestamps without SSR/client locale mismatches.
 * First paint uses a stable UTC string; after mount, switches to the UI locale.
 * `dateOnly` skips the clock. Calendar days (YYYY-MM-DD) do not shift timezone.
 */
export function LocalDateTime({
  value,
  className,
  prefix,
  dateOnly = false,
  locale,
}: {
  value: string;
  className?: string;
  prefix?: string;
  dateOnly?: boolean;
  locale?: string;
}) {
  const uiLocale = useLocale();
  const resolvedLocale = locale ?? uiLocale;
  const [label, setLabel] = useState(() =>
    dateOnly ? formatStableDate(value) : formatStableDateTime(value),
  );

  useEffect(() => {
    setLabel(
      dateOnly
        ? formatLocaleDate(value, resolvedLocale)
        : formatLocaleDateTime(value, resolvedLocale),
    );
  }, [dateOnly, resolvedLocale, value]);

  return (
    <time className={className} dateTime={value}>
      {prefix ? `${prefix}: ` : null}
      {label}
    </time>
  );
}
