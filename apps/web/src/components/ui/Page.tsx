import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

export function Page({
  children,
  narrow,
  wide,
  className,
}: {
  children: ReactNode;
  narrow?: boolean;
  wide?: boolean;
  className?: string;
}) {
  return (
    <main
      className={cn(
        'mx-auto w-full',
        narrow ? 'max-w-xl' : wide ? 'max-w-5xl' : 'max-w-3xl',
        className,
      )}
    >
      {children}
    </main>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        {eyebrow ? <p className="mb-1 text-sm text-ink-muted">{eyebrow}</p> : null}
        <h1 className="m-0 text-3xl font-semibold tracking-tight text-ink">{title}</h1>
        {description ? (
          <p className="mt-1.5 mb-0 text-ink-muted">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function SectionHeader({
  title,
  action,
}: {
  title: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="m-0 text-xl font-semibold tracking-tight">{title}</h2>
      {action}
    </div>
  );
}

export function ListCard({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <li className={cn('kh-panel list-none p-4 transition hover:border-brand/30', className)}>
      {children}
    </li>
  );
}
