'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { setThemeAction } from '../../lib/theme-actions';
import {
  applyResolvedTheme,
  defaultTheme,
  parseThemePreference,
  resolveTheme,
  themeCookieName,
  themePreferences,
  type ThemePreference,
} from '../../lib/theme';

function readThemeCookie(): ThemePreference {
  if (typeof document === 'undefined') {
    return defaultTheme;
  }
  const match = document.cookie.match(new RegExp(`(?:^|; )${themeCookieName}=([^;]*)`));
  const value = match ? decodeURIComponent(match[1]!) : defaultTheme;
  return parseThemePreference(value);
}

function systemIsDark(): boolean {
  return (
    typeof window !== 'undefined'
    && window.matchMedia('(prefers-color-scheme: dark)').matches
  );
}

function nextTheme(current: ThemePreference): ThemePreference {
  const index = themePreferences.indexOf(current);
  return themePreferences[(index + 1) % themePreferences.length]!;
}

function themeGlyph(choice: ThemePreference): string {
  return choice === 'dark' ? '●' : choice === 'light' ? '○' : '◐';
}

function themeLabel(
  choice: ThemePreference,
  t: (key: 'themeLight' | 'themeDark' | 'themeSystem') => string,
): string {
  if (choice === 'light') return t('themeLight');
  if (choice === 'dark') return t('themeDark');
  return t('themeSystem');
}

export function LandingThemeSegment({
  initialPreference,
}: {
  initialPreference: ThemePreference;
}) {
  const t = useTranslations('common');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [preference, setPreference] = useState<ThemePreference>(
    parseThemePreference(initialPreference),
  );

  useEffect(() => {
    setPreference(readThemeCookie());
  }, []);

  useEffect(() => {
    applyResolvedTheme(resolveTheme(preference, systemIsDark()));
    if (preference !== 'system') {
      return;
    }
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      applyResolvedTheme(resolveTheme('system', media.matches));
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [preference]);

  const upcoming = nextTheme(preference);
  const currentLabel = themeLabel(preference, t);

  return (
    <button
      type="button"
      className="kh-lp-cycle"
      data-theme-choice={preference}
      aria-label={`${t('theme')}: ${currentLabel}`}
      title={`${t('theme')}: ${currentLabel}`}
      disabled={pending}
      onClick={() => {
        setPreference(upcoming);
        applyResolvedTheme(resolveTheme(upcoming, systemIsDark()));
        startTransition(async () => {
          await setThemeAction(upcoming);
          router.refresh();
        });
      }}
    >
      {themeGlyph(preference)}
    </button>
  );
}
