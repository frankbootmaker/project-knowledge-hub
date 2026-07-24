'use client';

import { useEffect, useState } from 'react';

function formatUtc(value: string): string {
  return new Date(value).toLocaleString('en-GB', {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
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
  const [label, setLabel] = useState(() => formatUtc(value));

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
