'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { localeLabels, locales, type AppLocale } from '../i18n/config';
import { setLocaleAction } from '../lib/locale';
import { headerControlHeightClassName, headerIconClassName } from './header-control';
import { Button } from './ui';

function nextLocale(current: AppLocale): AppLocale {
  const index = locales.indexOf(current);
  return locales[(index + 1) % locales.length]!;
}

function GlobeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={headerIconClassName} fill="none">
      {/* Scaled to match sun/moon visual weight inside the shared icon box */}
      <g transform="translate(12 12) scale(0.82) translate(-12 -12)">
        <circle cx="12" cy="12" r="8.25" stroke="currentColor" strokeWidth="1.75" />
        <path
          d="M3.75 12h16.5M12 3.75c2.4 2.6 3.6 5.4 3.6 8.25S14.4 17.65 12 20.25M12 3.75C9.6 6.35 8.4 9.15 8.4 12s1.2 5.65 3.6 8.25"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
}

export function LanguageSwitcher() {
  const locale = useLocale() as AppLocale;
  const t = useTranslations('common');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const upcoming = nextLocale(locale);

  return (
    <Button
      type="button"
      variant="ghost"
      disabled={pending}
      aria-label={t('languageCycle', {
        current: localeLabels[locale],
        next: localeLabels[upcoming],
      })}
      title={t('languageCycle', {
        current: localeLabels[locale],
        next: localeLabels[upcoming],
      })}
      className={`${headerControlHeightClassName} shrink-0 gap-1.5 px-2 py-0`}
      onClick={() => {
        startTransition(async () => {
          await setLocaleAction(upcoming);
          router.refresh();
        });
      }}
    >
      <GlobeIcon />
      <span className="text-sm font-semibold tracking-wide text-ink">
        {locale.toUpperCase()}
      </span>
    </Button>
  );
}
