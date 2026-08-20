export const themeCookieName = 'kh_theme';

export const themePreferences = ['light', 'dark', 'system'] as const;
export type ThemePreference = (typeof themePreferences)[number];
export type ResolvedTheme = 'light' | 'dark';

/** Cookie-stored preference, including system. */
export type AppTheme = ThemePreference;

export const defaultTheme: ThemePreference = 'light';

export function isThemePreference(
  value: string | undefined | null,
): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system';
}

export function parseThemePreference(
  value: string | undefined | null,
): ThemePreference {
  if (isThemePreference(value)) {
    return value;
  }
  return defaultTheme;
}

/**
 * Maps cookie values onto a resolved light/dark theme.
 * `system` falls back to light when matchMedia is not available (SSR).
 */
export function parseTheme(value: string | undefined | null): ResolvedTheme {
  if (value === 'dark') {
    return 'dark';
  }
  return 'light';
}

export function resolveTheme(
  preference: ThemePreference,
  systemIsDark: boolean,
): ResolvedTheme {
  if (preference === 'system') {
    return systemIsDark ? 'dark' : 'light';
  }
  return preference;
}

export function applyResolvedTheme(resolved: ResolvedTheme): void {
  if (typeof document === 'undefined') {
    return;
  }
  const root = document.documentElement;
  root.classList.toggle('dark', resolved === 'dark');
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
  // Never set dataset.themePreference — unscoped [data-theme-preference]
  // queries in older prototype scripts wiped the document element.
}
