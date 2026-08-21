'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { localeLabels, locales, type AppLocale } from '../../i18n/config';
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

export function LanguageSelect() {
  const locale = useLocale() as AppLocale;
  const t = useTranslations('common');
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <select
      className="kh-ops-language-select"
      aria-label={t('language')}
      value={locale}
      disabled={pending}
      onChange={(event) => {
        const next = event.target.value as AppLocale;
        if (!locales.includes(next)) {
          return;
        }
        startTransition(async () => {
          await setLocaleAction(next);
          await syncPreferredLocale(next);
          router.refresh();
        });
      }}
    >
      {locales.map((code) => (
        <option key={code} value={code}>
          {code.toUpperCase()}
        </option>
      ))}
    </select>
  );
}

export { localeLabels };
