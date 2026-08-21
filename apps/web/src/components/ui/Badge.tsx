import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/cn';

type Tone = 'neutral' | 'brand' | 'success' | 'warn' | 'danger';

const tones: Record<Tone, string> = {
  neutral: 'bg-neutral-soft text-ink-muted',
  brand: 'bg-brand-soft text-brand',
  success: 'bg-accent-soft text-accent',
  warn: 'bg-warn-soft text-warn',
  danger: 'bg-danger-soft text-danger',
};

export function Badge({
  tone = 'neutral',
  className,
  children,
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  tone?: Tone;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-sm border border-current/25 px-1.5 py-0.5 font-mono text-[11px] font-semibold tracking-wide uppercase',
        tones[tone],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}

export function lifecycleTone(status: string): Tone {
  if (status === 'verified' || status === 'current') return 'success';
  if (status === 'superseded' || status === 'deprecated' || status === 'archived') {
    return 'danger';
  }
  if (status === 'review_required') return 'warn';
  if (status === 'draft') return 'neutral';
  return 'brand';
}

/** RAID severity → badge tone (low green → critical red). */
export function raidSeverityTone(severity: string): Tone {
  switch (severity) {
    case 'low':
      return 'success';
    case 'high':
      return 'warn';
    case 'critical':
      return 'danger';
    case 'medium':
    default:
      return 'neutral';
  }
}

/** Display label for a lifecycle status; maps API value `verified` → Approve wording. */
export function lifecycleLabel(
  status: string,
  t: (key: string) => string,
): string {
  const known = [
    'draft',
    'review_required',
    'verified',
    'current',
    'superseded',
    'deprecated',
    'archived',
  ];
  if (!known.includes(status)) return status;
  return t(`lifecycleLabels.${status}`);
}
