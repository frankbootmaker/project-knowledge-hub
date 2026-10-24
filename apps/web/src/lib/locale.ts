'use server';

import { cookies } from 'next/headers';
import { defaultLocale, isAppLocale, localeCookieName, type AppLocale } from '../i18n/config';
import { apiFetch } from './session';

export async function setLocaleAction(locale: string): Promise<void> {
  const nextLocale: AppLocale = isAppLocale(locale) ? locale : defaultLocale;
  const cookieStore = await cookies();
  cookieStore.set(localeCookieName, nextLocale, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
  });
  // Persist the preference in the same action. cookies().set already
  // refreshes the current route once; the client must not refresh again.
  try {
    await apiFetch('/api/v1/me', {
      method: 'PATCH',
      body: JSON.stringify({ preferredLocale: nextLocale }),
    });
  } catch {
    // Anonymous visitors only keep the cookie.
  }
}
