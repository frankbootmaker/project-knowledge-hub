export const brandCookieName = 'kh_brand';

export const brandIds = ['knowhub', 'bootmaker', 'nethorizon', 'in3'] as const;
export type BrandId = (typeof brandIds)[number];

export const defaultBrand: BrandId = 'knowhub';

export const brandMeta: Record<
  BrandId,
  { label: string; description: string }
> = {
  knowhub: {
    label: 'KnowHub',
    description: 'Green ops accent — default KnowHub console.',
  },
  bootmaker: {
    label: 'Bootmaker',
    description: 'Indigo / blue department accent.',
  },
  nethorizon: {
    label: 'Nethorizon',
    description: 'Teal department accent.',
  },
  in3: {
    label: 'IN3',
    description: 'Indigo department accent.',
  },
};

export function isBrandId(value: string | undefined | null): value is BrandId {
  return (
    value === 'knowhub' ||
    value === 'bootmaker' ||
    value === 'nethorizon' ||
    value === 'in3'
  );
}

export function parseBrand(value: string | undefined | null): BrandId {
  return isBrandId(value) ? value : defaultBrand;
}

export function applyBrand(brand: BrandId): void {
  if (typeof document === 'undefined') {
    return;
  }
  document.documentElement.dataset.brand = brand;
}
