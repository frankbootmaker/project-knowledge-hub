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

export function LandingLangSegment() {
  const locale = useLocale() as AppLocale;
  const t = useTranslations('common');
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div className="kh-lp-segment" role="group" aria-label={t('language')}>
      {locales.map((code) => {
        const active = locale === code;
        return (
          <button
            key={code}
            type="button"
            data-lang={code}
            aria-pressed={active}
            disabled={pending}
            onClick={() => {
              if (active) return;
              startTransition(async () => {
                await setLocaleAction(code);
                await syncPreferredLocale(code);
                router.refresh();
              });
            }}
          >
            {code.toUpperCase()}
          </button>
        );
      })}
    </div>
  );
}
