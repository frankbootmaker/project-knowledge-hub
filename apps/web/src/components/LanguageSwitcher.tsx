'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { localeLabels, locales, type AppLocale } from '../i18n/config';
import { setLocaleAction } from '../lib/locale';

export function LanguageSwitcher() {
  const locale = useLocale() as AppLocale;
  const t = useTranslations('common');
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.9rem' }}>
      <span style={{ opacity: 0.7 }}>{t('language')}</span>
      <select
        value={locale}
        disabled={pending}
        aria-label={t('language')}
        onChange={(event) => {
          const next = event.target.value;
          startTransition(async () => {
            await setLocaleAction(next);
            router.refresh();
          });
        }}
        style={{
          padding: '0.3rem 0.45rem',
          border: '1px solid rgba(21,32,43,0.2)',
          background: 'white',
        }}
      >
        {locales.map((code) => (
          <option key={code} value={code}>
            {localeLabels[code]}
          </option>
        ))}
      </select>
    </label>
  );
}
