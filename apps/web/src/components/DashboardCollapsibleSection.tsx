'use client';

import { useEffect, useId, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { SectionHeader } from './ui';
import { cn } from '../lib/cn';

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden
      className={cn(
        'size-4 shrink-0 text-ink-muted transition-transform',
        open && 'rotate-180',
      )}
      fill="none"
    >
      <path
        d="M5 8l5 5 5-5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function DashboardCollapsibleSection({
  storageKey,
  title,
  action,
  defaultOpen = true,
  children,
  className,
}: {
  storageKey: string;
  title: ReactNode;
  action?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const t = useTranslations('dashboard');
  const panelId = useId();
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    try {
      const stored = window.sessionStorage.getItem(
        `kh-dashboard-section:${storageKey}`,
      );
      if (stored === 'open') setOpen(true);
      if (stored === 'closed') setOpen(false);
    } catch {
      /* ignore */
    }
  }, [storageKey]);

  function toggle() {
    setOpen((current) => {
      const next = !current;
      try {
        window.sessionStorage.setItem(
          `kh-dashboard-section:${storageKey}`,
          next ? 'open' : 'closed',
        );
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  return (
    <section className={cn('mb-8', className)}>
      <SectionHeader
        title={
          <button
            type="button"
            className="inline-flex items-center gap-2 border-0 bg-transparent p-0 text-left text-xl font-semibold tracking-tight text-ink"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={toggle}
          >
            <ChevronIcon open={open} />
            <span>{title}</span>
            <span className="sr-only">
              {open ? t('collapseSection') : t('expandSection')}
            </span>
          </button>
        }
        action={action}
      />
      <div id={panelId} hidden={!open}>
        {open ? children : null}
      </div>
    </section>
  );
}
