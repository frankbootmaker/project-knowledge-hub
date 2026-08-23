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

  return (
    <div className="kh-lp-segment" role="group" aria-label={t('theme')}>
      {themePreferences.map((choice) => {
        const label =
          choice === 'light'
            ? t('themeLight')
            : choice === 'dark'
              ? t('themeDark')
              : t('themeSystem');
        const glyph = choice === 'dark' ? '●' : choice === 'light' ? '○' : '◐';
        const active = preference === choice;
        return (
          <button
            key={choice}
            type="button"
            data-theme-choice={choice}
            aria-pressed={active}
            disabled={pending}
            onClick={() => {
              setPreference(choice);
              applyResolvedTheme(resolveTheme(choice, systemIsDark()));
              startTransition(async () => {
                await setThemeAction(choice);
                router.refresh();
              });
            }}
          >
            <span className="kh-lp-theme-word">{label}</span> {glyph}
          </button>
        );
      })}
    </div>
  );
}
