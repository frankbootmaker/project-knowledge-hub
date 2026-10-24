'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { locales, type AppLocale } from '../../i18n/config';
import { setLocaleAction } from '../../lib/locale';

function nextLocale(current: AppLocale): AppLocale {
  const index = locales.indexOf(current);
  return locales[(index + 1) % locales.length]!;
}

export function LandingLangSegment() {
  const locale = useLocale() as AppLocale;
  const t = useTranslations('common');
  const [pending, startTransition] = useTransition();
  const upcoming = nextLocale(locale);

  return (
    <button
      type="button"
      className="kh-lp-cycle"
      aria-label={`${t('language')}: ${locale.toUpperCase()}`}
      title={`${t('language')}: ${locale.toUpperCase()}`}
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          await setLocaleAction(upcoming);
        });
      }}
    >
      {locale.toUpperCase()}
    </button>
  );
}
