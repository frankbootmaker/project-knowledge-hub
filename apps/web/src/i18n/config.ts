export const locales = ['en', 'de', 'hu'] as const;
export type AppLocale = (typeof locales)[number];

export const defaultLocale: AppLocale = 'en';
export const localeCookieName = 'NEXT_LOCALE';

export const localeLabels: Record<AppLocale, string> = {
  en: 'English',
  de: 'Deutsch',
  hu: 'Magyar',
};

export function isAppLocale(value: string | undefined | null): value is AppLocale {
  return Boolean(value && (locales as readonly string[]).includes(value));
}
