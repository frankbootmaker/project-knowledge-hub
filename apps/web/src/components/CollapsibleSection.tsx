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

/** Collapsible page section with session-persisted open/closed state. */
export function CollapsibleSection({
  id,
  storageKey,
  title,
  action,
  defaultOpen = true,
  children,
  className,
}: {
  /** Anchor target for in-page navigation (`#id`). */
  id?: string;
  storageKey: string;
  title: ReactNode;
  action?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const t = useTranslations('common');
  const panelId = useId();
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    try {
      const stored = window.sessionStorage.getItem(`kh-section:${storageKey}`);
      if (stored === 'open') setOpen(true);
      if (stored === 'closed') setOpen(false);
    } catch {
      /* ignore */
    }
    if (id && window.location.hash === `#${id}`) {
      setOpen(true);
    }
  }, [id, storageKey]);

  useEffect(() => {
    if (!id) return;
    function openFromHash() {
      if (window.location.hash !== `#${id}`) return;
      setOpen(true);
      try {
        window.sessionStorage.setItem(`kh-section:${storageKey}`, 'open');
      } catch {
        /* ignore */
      }
    }
    window.addEventListener('hashchange', openFromHash);
    return () => window.removeEventListener('hashchange', openFromHash);
  }, [id, storageKey]);

  function toggle() {
    setOpen((current) => {
      const next = !current;
      try {
        window.sessionStorage.setItem(
          `kh-section:${storageKey}`,
          next ? 'open' : 'closed',
        );
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  return (
    <section id={id} className={cn('mb-6 scroll-mt-6', className)}>
      <SectionHeader
        title={
          <button
            type="button"
            className="inline-flex items-center gap-2 border-0 bg-transparent p-0 text-left font-display text-[13px] font-bold tracking-tight text-ink"
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

/** @deprecated Prefer CollapsibleSection — kept for existing dashboard imports. */
export const DashboardCollapsibleSection = CollapsibleSection;
