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
        'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold tracking-wide',
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
