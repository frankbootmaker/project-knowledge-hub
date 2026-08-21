import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

export function Page({
  children,
  narrow,
  wide,
  viewport,
  className,
}: {
  children: ReactNode;
  narrow?: boolean;
  wide?: boolean;
  /** Near-full viewport width (knowledge editor pages). */
  viewport?: boolean;
  className?: string;
}) {
  return (
    <main
      className={cn(
        'mx-auto w-full',
        narrow
          ? 'max-w-xl'
          : viewport
            ? 'max-w-[min(90vw,96rem)]'
            : wide
              ? 'max-w-[min(100%,88rem)]'
              : 'max-w-3xl',
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
  nav,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
  /** Quick in-page links shown directly under the title. */
  nav?: ReactNode;
}) {
  return (
    <div className="mb-4">
      <div className="kh-ops-view-intro">
        <div className="min-w-0">
          {eyebrow ? <p className="kh-ops-eyebrow">{eyebrow}</p> : null}
          <h1 className="kh-ops-page-title">{title}</h1>
          {description ? (
            <div className="kh-ops-subtitle">{description}</div>
          ) : null}
        </div>
        {actions ? (
          <div className="kh-ops-view-intro-actions flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto">
            {actions}
          </div>
        ) : null}
      </div>
      {nav ? <div className="mt-1 mb-3">{nav}</div> : null}
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
    <div className="kh-ops-panel-head mb-3 border-line px-0">
      <h2 className="kh-ops-panel-title min-w-0 truncate">
        {title}
      </h2>
      {action ? (
        <div className="min-w-0 shrink-0 max-w-[calc(100%-6.5rem)] sm:max-w-none">
          {action}
        </div>
      ) : null}
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
    <li className={cn('kh-ops-data-item list-none', className)}>
      {children}
    </li>
  );
}
