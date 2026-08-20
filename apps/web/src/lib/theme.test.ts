import { describe, expect, it } from 'vitest';
import {
  parseTheme,
  parseThemePreference,
  resolveTheme,
} from './theme';

describe('theme preference', () => {
  it('accepts light, dark, and system', () => {
    expect(parseThemePreference('light')).toBe('light');
    expect(parseThemePreference('dark')).toBe('dark');
    expect(parseThemePreference('system')).toBe('system');
  });

  it('falls back to light for unknown values', () => {
    expect(parseThemePreference('nope')).toBe('light');
    expect(parseThemePreference(undefined)).toBe('light');
  });

  it('resolves system against matchMedia', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('light', true)).toBe('light');
  });

  it('SSR parseTheme maps system to light', () => {
    expect(parseTheme('system')).toBe('light');
    expect(parseTheme('dark')).toBe('dark');
  });
});
