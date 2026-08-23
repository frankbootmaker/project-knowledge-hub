'use server';

import { cookies } from 'next/headers';
import {
  brandCookieName,
  defaultBrand,
  fallbackBrandSettings,
  isBrandId,
  parseBrand,
  resolveEffectiveBrand,
  type BrandId,
  type PlatformBrandSettings,
} from './brand';
import { apiFetch } from './session';

export async function loadPlatformBrandSettings(): Promise<PlatformBrandSettings> {
  try {
    const response = await apiFetch('/api/v1/brand-settings');
    if (!response.ok) return fallbackBrandSettings;
    const payload = (await response.json()) as {
      settings?: { defaultBrand?: string; locked?: boolean };
    };
    const defaultBrandId = isBrandId(payload.settings?.defaultBrand)
      ? payload.settings.defaultBrand
      : defaultBrand;
    return {
      defaultBrand: defaultBrandId,
      locked: Boolean(payload.settings?.locked),
    };
  } catch {
    return fallbackBrandSettings;
  }
}

export async function getPersonalBrandCookie(): Promise<BrandId | null> {
  const cookieStore = await cookies();
  const value = cookieStore.get(brandCookieName)?.value;
  return isBrandId(value) ? value : null;
}

export async function getBrandPreference(): Promise<BrandId> {
  const settings = await loadPlatformBrandSettings();
  const personal = await getPersonalBrandCookie();
  return resolveEffectiveBrand(settings, personal);
}

export async function setBrandAction(brand: string): Promise<void> {
  const settings = await loadPlatformBrandSettings();
  if (settings.locked) {
    return;
  }
  const next = parseBrand(brand);
  const cookieStore = await cookies();
  cookieStore.set(brandCookieName, next, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
  });
}

export async function clearBrandAction(): Promise<void> {
  const settings = await loadPlatformBrandSettings();
  if (settings.locked) {
    return;
  }
  const cookieStore = await cookies();
  cookieStore.delete(brandCookieName);
}
