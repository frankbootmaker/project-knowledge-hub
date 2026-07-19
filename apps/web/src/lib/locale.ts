'use server';

import { cookies } from 'next/headers';
import { defaultLocale, isAppLocale, localeCookieName, type AppLocale } from '../i18n/config';

export async function setLocaleAction(locale: string): Promise<void> {
  const nextLocale: AppLocale = isAppLocale(locale) ? locale : defaultLocale;
  const cookieStore = await cookies();
  cookieStore.set(localeCookieName, nextLocale, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
  });
}
