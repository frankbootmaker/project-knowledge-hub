'use client';

import {
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { mediaAbsoluteUrl } from '../lib/media-image';
import { cn } from '../lib/cn';
import { headerControlSquareClassName } from './header-control';
import { Button } from './ui/Button';

export type MediaLightboxItem = {
  id: string;
  url: string;
  title?: string | null;
  alt?: string | null;
};

type Props = {
  open: boolean;
  items: MediaLightboxItem[];
  index: number;
  onClose: () => void;
  onIndexChange: (index: number) => void;
};

export function MediaLightbox({
  open,
  items,
  index,
  onClose,
  onIndexChange,
}: Props) {
  const t = useTranslations('media');
  const tCommon = useTranslations('common');
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);

  const item = items[index] ?? null;
  const hasPrev = index > 0;
  const hasNext = index < items.length - 1;
  const alt = item?.alt ?? item?.title ?? '';

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) {
      document.body.style.removeProperty('overflow');
      previouslyFocused.current?.focus();
      previouslyFocused.current = null;
      return;
    }

    setLoading(true);
    previouslyFocused.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    document.body.style.overflow = 'hidden';

    const panel = panelRef.current;
    const preferred =
      panel?.querySelector<HTMLElement>('[data-lightbox-initial-focus]') ??
      panel?.querySelector<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
    preferred?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key === 'ArrowLeft' && index > 0) {
        event.preventDefault();
        onIndexChange(index - 1);
        return;
      }
      if (event.key === 'ArrowRight' && index < items.length - 1) {
        event.preventDefault();
        onIndexChange(index + 1);
        return;
      }
      if (event.key !== 'Tab' || !panel) {
        return;
      }
      const focusables = panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
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
  }, [open, index, items.length, onIndexChange]);

  useEffect(() => {
    if (open) {
      setLoading(true);
    }
  }, [open, item?.url]);

  if (!open || !mounted || !item) {
    return null;
  }

  const originalHref = mediaAbsoluteUrl(item.url);

  return createPortal(
    <div className="kh-media-lightbox">
      <button
        type="button"
        className="kh-media-lightbox__backdrop"
        aria-label={tCommon('closeDialog')}
        onClick={() => onCloseRef.current()}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="kh-media-lightbox__panel"
      >
        <div className="kh-media-lightbox__toolbar">
          <p id={titleId} className="kh-media-lightbox__title">
            {item.title || t('lightboxUntitled')}
          </p>
          <div className="kh-media-lightbox__actions">
            {items.length > 1 ? (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  className="kh-media-lightbox__nav"
                  disabled={!hasPrev}
                  aria-label={t('lightboxPrevious')}
                  onClick={() => onIndexChange(index - 1)}
                >
                  {t('lightboxPrevious')}
                </Button>
                <span className="kh-media-lightbox__counter" aria-live="polite">
                  {index + 1} / {items.length}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  className="kh-media-lightbox__nav"
                  disabled={!hasNext}
                  aria-label={t('lightboxNext')}
                  onClick={() => onIndexChange(index + 1)}
                >
                  {t('lightboxNext')}
                </Button>
              </>
            ) : null}
            <a
              href={originalHref}
              target="_blank"
              rel="noopener noreferrer"
              className="kh-media-lightbox__open"
              data-lightbox-initial-focus
            >
              {t('lightboxOpenOriginal')}
            </a>
            <Button
              type="button"
              variant="ghost"
              className={cn(headerControlSquareClassName, 'kh-media-lightbox__close')}
              aria-label={tCommon('closeDialog')}
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
        </div>
        <div className="kh-media-lightbox__stage">
          {loading ? (
            <p className="kh-media-lightbox__loading" role="status">
              {t('lightboxLoading')}
            </p>
          ) : null}
          <img
            key={item.url}
            className={cn(
              'kh-media-lightbox__img',
              loading && 'kh-media-lightbox__img--loading',
            )}
            src={item.url}
            alt={alt}
            decoding="async"
            onLoad={() => setLoading(false)}
            onError={() => setLoading(false)}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}
