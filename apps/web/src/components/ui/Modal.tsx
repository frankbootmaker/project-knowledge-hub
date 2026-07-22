'use client';

import {
  useEffect,
  useId,
  useRef,
  type ReactNode,
} from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '../../lib/cn';
import { headerControlSquareClassName } from '../header-control';
import { Button } from './Button';

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Wider sheet for denser forms (e.g. API client scopes). `xl` ≈ 90vw editor. */
  size?: 'md' | 'lg' | 'xl';
  /** When false, backdrop click does not close (Esc still does). Default true. */
  closeOnBackdrop?: boolean;
};

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  closeOnBackdrop = true,
}: Props) {
  const t = useTranslations('common');
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

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
    const preferred =
      panel?.querySelector<HTMLElement>('[data-modal-initial-focus]') ??
      panel?.querySelector<HTMLElement>(
        'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
      );
    preferred?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !panel) {
        return;
      }
      const focusables = panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusables.length) {
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
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div className="kh-modal">
      <button
        type="button"
        className="kh-modal-backdrop"
        aria-label={t('closeDialog')}
        onClick={() => {
          if (closeOnBackdrop) {
            onCloseRef.current();
          }
        }}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        className={cn(
          'kh-modal-panel',
          size === 'lg' && 'kh-modal-panel-lg',
          size === 'xl' && 'kh-modal-panel-xl',
        )}
      >
        <div className="kh-modal-header">
          <div className="min-w-0">
            <h2 id={titleId} className="kh-modal-title">
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} className="kh-modal-description">
                {description}
              </p>
            ) : null}
          </div>
          <Button
            type="button"
            variant="ghost"
            className={cn(headerControlSquareClassName, 'shrink-0 p-0')}
            aria-label={t('closeDialog')}
            onClick={() => onCloseRef.current()}
          >
            <svg
              viewBox="0 0 24 24"
              aria-hidden
              className="size-5"
              fill="none"
            >
              <path
                d="M6 6l12 12M18 6L6 18"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
              />
            </svg>
          </Button>
        </div>
        <div className="kh-modal-body">{children}</div>
        {footer ? <div className="kh-modal-footer">{footer}</div> : null}
      </div>
    </div>
  );
}
