'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { setThemeAction } from '../lib/theme-actions';
import {
  defaultTheme,
  parseTheme,
  themeCookieName,
  type AppTheme,
} from '../lib/theme';
import { headerControlSquareClassName, themeIconClassName } from './header-control';
import { Button } from './ui';

function readThemeCookie(): AppTheme {
  if (typeof document === 'undefined') {
    return defaultTheme;
  }
  const match = document.cookie.match(new RegExp(`(?:^|; )${themeCookieName}=([^;]*)`));
  const value = match ? decodeURIComponent(match[1]!) : defaultTheme;
  return parseTheme(value);
}

function applyTheme(theme: AppTheme) {
  const dark = theme === 'dark';
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
}

function ThemeIcon({ theme }: { theme: AppTheme }) {
  if (theme === 'dark') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden className={themeIconClassName} fill="none">
        <path
          d="M15.5 3.5a7.5 7.5 0 1 0 5 12.8A8.5 8.5 0 1 1 15.5 3.5Z"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden className={themeIconClassName} fill="none">
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.75" />
      <path
        d="M12 3v1.5M12 19.5V21M4.93 4.93l1.06 1.06M18.01 18.01l1.06 1.06M3 12h1.5M19.5 12H21M4.93 19.07l1.06-1.06M18.01 5.99l1.06-1.06"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function ThemeSwitcher({ initialTheme }: { initialTheme: AppTheme }) {
  const t = useTranslations('common');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [theme, setTheme] = useState<AppTheme>(parseTheme(initialTheme));

  useEffect(() => {
    setTheme(readThemeCookie());
  }, []);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const label = theme === 'dark' ? t('themeDark') : t('themeLight');
  const next = theme === 'dark' ? 'light' : 'dark';
  const nextLabel = next === 'dark' ? t('themeDark') : t('themeLight');

  return (
    <Button
      type="button"
      variant="ghost"
      disabled={pending}
      aria-label={t('themeCycle', { current: label, next: nextLabel })}
      title={t('themeCycle', { current: label, next: nextLabel })}
      className={`${headerControlSquareClassName} shrink-0 px-0 py-0`}
      onClick={() => {
        setTheme(next);
        applyTheme(next);
        startTransition(async () => {
          await setThemeAction(next);
          router.refresh();
        });
      }}
    >
      <ThemeIcon theme={theme} />
    </Button>
  );
}
