export const themeCookieName = 'kh_theme';
export const themes = ['light', 'dark'] as const;
export type AppTheme = (typeof themes)[number];
export const defaultTheme: AppTheme = 'light';

export function isAppTheme(value: string | undefined | null): value is AppTheme {
  return value === 'light' || value === 'dark';
}

/** Maps cookie values (including legacy "system") onto light/dark. */
export function parseTheme(value: string | undefined | null): AppTheme {
  if (isAppTheme(value)) {
    return value;
  }
  return defaultTheme;
}
