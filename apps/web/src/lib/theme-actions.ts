'use server';

import { cookies } from 'next/headers';
import {
  defaultTheme,
  parseTheme,
  themeCookieName,
  type AppTheme,
} from './theme';

export async function setThemeAction(theme: string): Promise<void> {
  const nextTheme: AppTheme = parseTheme(theme);
  const cookieStore = await cookies();
  cookieStore.set(themeCookieName, nextTheme, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
  });
}

export async function getThemePreference(): Promise<AppTheme> {
  const cookieStore = await cookies();
  const value = cookieStore.get(themeCookieName)?.value;
  return parseTheme(value) || defaultTheme;
}
