'use server';

import { cookies } from 'next/headers';
import {
  brandCookieName,
  defaultBrand,
  parseBrand,
  type BrandId,
} from './brand';

export async function setBrandAction(brand: string): Promise<void> {
  const next = parseBrand(brand);
  const cookieStore = await cookies();
  cookieStore.set(brandCookieName, next, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
  });
}

export async function getBrandPreference(): Promise<BrandId> {
  const cookieStore = await cookies();
  const value = cookieStore.get(brandCookieName)?.value;
  return parseBrand(value) || defaultBrand;
}
