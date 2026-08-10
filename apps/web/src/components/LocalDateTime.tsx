'use client';

import { useEffect, useState } from 'react';

/** Stable UTC label for SSR + first client paint (no Intl padding quirks). */
function formatUtcStable(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = String(date.getUTCFullYear());
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mi = String(date.getUTCMinutes()).padStart(2, '0');
  const ss = String(date.getUTCSeconds()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy}, ${hh}:${mi}:${ss}`;
}

/**
 * Format timestamps without SSR/client locale mismatches.
 * First paint uses a stable UTC string; after mount, switches to local time.
 */
export function LocalDateTime({
  value,
  className,
  prefix,
}: {
  value: string;
  className?: string;
  prefix?: string;
}) {
  const [label, setLabel] = useState(() => formatUtcStable(value));

  useEffect(() => {
    setLabel(new Date(value).toLocaleString());
  }, [value]);

  return (
    <time className={className} dateTime={value}>
      {prefix ? `${prefix}: ` : null}
      {label}
    </time>
  );
}
