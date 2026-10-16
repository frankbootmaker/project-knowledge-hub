import type { ReactNode } from 'react';
import Link from 'next/link';
import { cn } from '../lib/cn';

/** Arrow return link used under lists and in form headers. */
export function BackLink({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'inline-flex items-center gap-2 text-sm text-ink-muted no-underline hover:text-ink',
        className,
      )}
    >
      <svg
        viewBox="0 0 16 16"
        width="16"
        height="16"
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M10 3L5 8l5 5" />
      </svg>
      {children}
    </Link>
  );
}

/** Bottom-of-panel return link, matching an open knowledge article. */
export function PanelBackLink({
  href,
  children,
  divided = true,
  className,
}: {
  href: string;
  children: ReactNode;
  /** Draw a rule above the link when it follows other panel content. */
  divided?: boolean;
  className?: string;
}) {
  return (
    <div className={cn(divided ? 'border-t border-line px-5 py-4' : 'px-5 py-4', className)}>
      <BackLink href={href}>{children}</BackLink>
    </div>
  );
}
