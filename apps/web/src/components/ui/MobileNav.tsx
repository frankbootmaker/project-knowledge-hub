'use client';

import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { cn } from '../../lib/cn';
import { headerControlSquareClassName } from '../header-control';
import { Button } from './Button';
import { NavLink } from './NavLink';

export type MobileNavItem = {
  href: string;
  label: string;
  exact?: boolean;
};

type Props = {
  items: MobileNavItem[];
  /** Extra footer content inside the sheet (e.g. account actions). */
  footer?: ReactNode;
};

function MenuIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className="size-5 shrink-0"
      fill="none"
    >
      {open ? (
        <path
          d="M6 6l12 12M18 6L6 18"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
        />
      ) : (
        <path
          d="M4 7h16M4 12h16M4 17h16"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}

export function MobileNav({ items, footer }: Props) {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    close();
  }, [pathname, close]);

  useEffect(() => {
    if (!open) {
      document.body.style.removeProperty('overflow');
      previouslyFocused.current?.focus();
      previouslyFocused.current = null;
      return;
    }

    previouslyFocused.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    document.body.style.overflow = 'hidden';

    const panel = panelRef.current;
    const focusables = panel?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    focusables?.[0]?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== 'Tab' || !panel || !focusables?.length) {
        return;
      }
      const list = Array.from(focusables);
      const first = list[0]!;
      const last = list[list.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.removeProperty('overflow');
    };
  }, [open, close]);

  if (items.length === 0) {
    return null;
  }

  return (
    <div className="sm:hidden">
      <Button
        type="button"
        variant="ghost"
        className={cn(headerControlSquareClassName, 'p-0')}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={open ? t('closeMenu') : t('openMenu')}
        onClick={() => setOpen((current) => !current)}
      >
        <MenuIcon open={open} />
      </Button>

      {open ? (
        <div className="kh-mobile-nav">
          <button
            type="button"
            className="kh-mobile-nav-backdrop"
            aria-label={t('closeMenu')}
            onClick={close}
          />
          <div
            ref={panelRef}
            id={panelId}
            role="dialog"
            aria-modal="true"
            aria-label={t('menu')}
            className="kh-mobile-nav-panel"
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="m-0 text-sm font-semibold text-ink">{t('menu')}</p>
              <Button
                type="button"
                variant="ghost"
                className={cn(headerControlSquareClassName, 'p-0')}
                aria-label={t('closeMenu')}
                onClick={close}
              >
                <MenuIcon open />
              </Button>
            </div>
            <nav className="grid gap-1">
              {items.map((item) => (
                <NavLink
                  key={item.href}
                  href={item.href}
                  tone="sidebar"
                  exact={item.exact}
                  onClick={close}
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
            {footer ? <div className="mt-4 border-t border-line pt-4">{footer}</div> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
