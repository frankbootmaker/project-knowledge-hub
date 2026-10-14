'use client';

import { useEffect, useState } from 'react';

function utcParts(value: string): { dd: string; mm: string; yyyy: string } | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return {
    dd: String(date.getUTCDate()).padStart(2, '0'),
    mm: String(date.getUTCMonth() + 1).padStart(2, '0'),
    yyyy: String(date.getUTCFullYear()),
  };
}

/** Stable UTC label for SSR + first client paint (no Intl padding quirks). */
function formatUtcStable(value: string): string {
  const parts = utcParts(value);
  if (!parts) return value;
  const date = new Date(value);
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mi = String(date.getUTCMinutes()).padStart(2, '0');
  const ss = String(date.getUTCSeconds()).padStart(2, '0');
  return `${parts.dd}/${parts.mm}/${parts.yyyy}, ${hh}:${mi}:${ss}`;
}

function formatUtcDate(value: string): string {
  const parts = utcParts(value);
  if (!parts) return value;
  return `${parts.dd}/${parts.mm}/${parts.yyyy}`;
}

/**
 * Format timestamps without SSR/client locale mismatches.
 * First paint uses a stable UTC string; after mount, switches to local time.
 * `dateOnly` skips the clock. Pass `locale` so the post-mount label matches the UI language.
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
  const [label, setLabel] = useState(() =>
    dateOnly ? formatUtcDate(value) : formatUtcStable(value),
  );

  useEffect(() => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      setLabel(value);
      return;
    }
    setLabel(
      dateOnly
        ? date.toLocaleDateString(locale, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          })
        : date.toLocaleString(locale),
    );
  }, [dateOnly, locale, value]);

  return (
    <time className={className} dateTime={value}>
      {prefix ? `${prefix}: ` : null}
      {label}
    </time>
  );
}
