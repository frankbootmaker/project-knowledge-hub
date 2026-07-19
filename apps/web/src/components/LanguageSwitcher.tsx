'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { localeLabels, locales, type AppLocale } from '../i18n/config';
import { setLocaleAction } from '../lib/locale';
import { Select } from './ui';

export function LanguageSwitcher() {
  const locale = useLocale() as AppLocale;
  const t = useTranslations('common');
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <label className="flex items-center gap-2 text-sm text-ink-muted">
      <span className="sr-only sm:not-sr-only">{t('language')}</span>
      <Select
        value={locale}
        disabled={pending}
        aria-label={t('language')}
        className="w-auto min-w-28 py-1.5 text-sm"
        onChange={(event) => {
          const next = event.target.value;
          startTransition(async () => {
            await setLocaleAction(next);
            router.refresh();
          });
        }}
      >
        {locales.map((code) => (
          <option key={code} value={code}>
            {localeLabels[code]}
          </option>
        ))}
      </Select>
    </label>
  );
}
