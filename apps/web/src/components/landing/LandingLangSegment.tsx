'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { locales, type AppLocale } from '../../i18n/config';
import { setLocaleAction } from '../../lib/locale';

async function syncPreferredLocale(locale: AppLocale): Promise<void> {
  try {
    await fetch('/api/v1/me', {
      method: 'PATCH',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Origin: window.location.origin,
      },
      body: JSON.stringify({ preferredLocale: locale }),
    });
  } catch {
    // Anonymous visitors only keep the cookie.
  }
}

function nextLocale(current: AppLocale): AppLocale {
  const index = locales.indexOf(current);
  return locales[(index + 1) % locales.length]!;
}

export function LandingLangSegment() {
  const locale = useLocale() as AppLocale;
  const t = useTranslations('common');
  const router = useRouter();
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
          await syncPreferredLocale(upcoming);
          router.refresh();
        });
      }}
    >
      {locale.toUpperCase()}
    </button>
  );
}
