'use server';

import { cookies } from 'next/headers';
import {
  defaultTheme,
  parseThemePreference,
  themeCookieName,
  type ThemePreference,
} from './theme';

export async function setThemeAction(theme: string): Promise<void> {
  const nextTheme: ThemePreference = parseThemePreference(theme);
  const cookieStore = await cookies();
  cookieStore.set(themeCookieName, nextTheme, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
  });
}

export async function getThemePreference(): Promise<ThemePreference> {
  const cookieStore = await cookies();
  const value = cookieStore.get(themeCookieName)?.value;
  return parseThemePreference(value) || defaultTheme;
}
