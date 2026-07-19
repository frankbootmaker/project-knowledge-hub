import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'success' | 'danger';

const variants: Record<Variant, string> = {
  primary:
    'border-transparent bg-brand text-white hover:bg-brand-hover disabled:bg-brand/50',
  secondary:
    'border-line-strong bg-panel-solid text-ink hover:bg-brand-soft disabled:opacity-50',
  ghost:
    'border-transparent bg-transparent text-ink-muted hover:bg-brand-soft hover:text-ink',
  success:
    'border-transparent bg-accent text-white hover:bg-accent/90 disabled:bg-accent/50',
  danger:
    'border-transparent bg-danger text-white hover:bg-danger/90 disabled:bg-danger/50',
};

export function Button({
  variant = 'primary',
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  children: ReactNode;
}) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-md border px-3.5 py-2 text-sm font-medium',
        'transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30',
        'disabled:cursor-not-allowed',
        variants[variant],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
