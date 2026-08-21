import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

export type OpsCountItem = {
  label: string;
  value: ReactNode;
};

export function OpsCountStrip({
  items,
  className,
}: {
  items: OpsCountItem[];
  className?: string;
}) {
  if (items.length === 0) return null;
  const cols = Math.min(Math.max(items.length, 2), 5);

  return (
    <div
      className={cn('kh-ops-count-strip', className)}
      data-cols={cols}
    >
      {items.map((item) => (
        <div key={item.label} className="kh-ops-count-item">
          <small>{item.label}</small>
          <strong>{item.value}</strong>
        </div>
      ))}
    </div>
  );
}
