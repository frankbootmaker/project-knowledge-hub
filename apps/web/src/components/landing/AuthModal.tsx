'use client';

import { Suspense, useEffect, useId, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { createPortal } from 'react-dom';
import {
  authPathForMode,
  isAuthRoutePath,
  type AuthMode,
} from './auth-mode';
import { ForgotPasswordForm } from './ForgotPasswordForm';
import { LoginForm } from './LoginForm';
import { RegisterForm } from './RegisterForm';

function useAuthCopy(mode: AuthMode) {
  const login = useTranslations('login');
  const register = useTranslations('register');
  const forgot = useTranslations('forgotPassword');

  if (mode === 'register') {
    return {
      brand: register('accessBrand'),
      eyebrow: register('eyebrow'),
      title: register('title'),
      subtitle: register('subtitle'),
    };
  }
  if (mode === 'forgot-password') {
    return {
      brand: forgot('accessBrand'),
      eyebrow: forgot('eyebrow'),
      title: forgot('title'),
      subtitle: forgot('subtitle'),
    };
  }
  return {
    brand: login('accessBrand'),
    eyebrow: login('eyebrow'),
    title: login('welcomeTitle'),
    subtitle: login('subtitle'),
  };
}

export function AuthModal({
  open,
  mode,
  onModeChange,
  onClose,
}: {
  open: boolean;
  mode: AuthMode;
  onModeChange: (mode: AuthMode) => void;
  onClose: () => void;
}) {
  const tCommon = useTranslations('common');
  const copy = useAuthCopy(mode);
  const pathname = usePathname();
  const router = useRouter();
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const pathnameRef = useRef(pathname);
  const routerRef = useRef(router);
  onCloseRef.current = onClose;
  pathnameRef.current = pathname;
  routerRef.current = router;
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  function handleClose() {
    onCloseRef.current();
    if (isAuthRoutePath(pathnameRef.current)) {
      routerRef.current.push('/');
    }
  }

  function handleNavigate(next: AuthMode) {
    onModeChange(next);
    if (isAuthRoutePath(pathnameRef.current)) {
      const search =
        next === 'login' && typeof window !== 'undefined'
          ? window.location.search
          : '';
      routerRef.current.replace(`${authPathForMode(next)}${search}`, {
        scroll: false,
      });
    }
  }

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
        if (isAuthRoutePath(pathnameRef.current)) {
          routerRef.current.push('/');
        }
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
  }, [open, mode]);

  if (!open || !mounted) {
    return null;
  }

  return createPortal(
    <div className="kh-lp-login-modal">
      <button
        type="button"
        className="kh-lp-login-backdrop"
        aria-label={tCommon('closeDialog')}
        onClick={handleClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="kh-lp-login-panel"
      >
        <div className="kh-lp-login-panel-header">
          <div className="kh-lp-login-brand">
            <span className="kh-lp-mark" aria-hidden>
              KH
            </span>
            <span>{copy.brand}</span>
          </div>
          <button
            type="button"
            className="kh-lp-login-close"
            aria-label={tCommon('closeDialog')}
            onClick={handleClose}
          >
            <svg viewBox="0 0 24 24" aria-hidden className="size-5" fill="none">
              <path
                d="M6 6l12 12M18 6L6 18"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
        <div className="kh-lp-login-panel-body">
          <p className="kh-lp-login-eyebrow">{copy.eyebrow}</p>
          <h2 id={titleId} className="kh-lp-login-title">
            {copy.title}
          </h2>
          <p id={descriptionId} className="kh-lp-login-subtitle">
            {copy.subtitle}
          </p>
          <Suspense fallback={null}>
            {mode === 'login' ? (
              <LoginForm onNavigate={handleNavigate} />
            ) : null}
            {mode === 'register' ? (
              <RegisterForm onNavigate={handleNavigate} />
            ) : null}
            {mode === 'forgot-password' ? (
              <ForgotPasswordForm onNavigate={handleNavigate} />
            ) : null}
          </Suspense>
        </div>
      </div>
    </div>,
    document.body,
  );
}
