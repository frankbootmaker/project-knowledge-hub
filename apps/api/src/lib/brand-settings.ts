import { eq } from 'drizzle-orm';
import { platformSettings, type Database } from '@project-knowledge-hub/database';

export const BRAND_SETTINGS_KEY = 'ui_brand';

export const BRAND_IDS = ['knowhub', 'bootmaker', 'nethorizon', 'in3'] as const;
export type PlatformBrandId = (typeof BRAND_IDS)[number];

export type BrandSettings = {
  defaultBrand: PlatformBrandId;
  locked: boolean;
};

export const DEFAULT_BRAND_SETTINGS: BrandSettings = {
  defaultBrand: 'knowhub',
  locked: false,
};

export function isPlatformBrandId(
  value: string | undefined | null,
): value is PlatformBrandId {
  return (
    value === 'knowhub' ||
    value === 'bootmaker' ||
    value === 'nethorizon' ||
    value === 'in3'
  );
}

function normalizeSettings(value: unknown): BrandSettings {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_BRAND_SETTINGS };
  }
  const record = value as Record<string, unknown>;
  return {
    defaultBrand: isPlatformBrandId(String(record.defaultBrand ?? ''))
      ? (record.defaultBrand as PlatformBrandId)
      : DEFAULT_BRAND_SETTINGS.defaultBrand,
    locked: Boolean(record.locked),
  };
}

export async function getBrandSettings(database: Database): Promise<BrandSettings> {
  const [row] = await database.db
    .select()
    .from(platformSettings)
    .where(eq(platformSettings.key, BRAND_SETTINGS_KEY))
    .limit(1);
  if (!row?.value?.trim()) {
    return { ...DEFAULT_BRAND_SETTINGS };
  }
  try {
    return normalizeSettings(JSON.parse(row.value) as unknown);
  } catch {
    return { ...DEFAULT_BRAND_SETTINGS };
  }
}

export async function setBrandSettings(
  database: Database,
  patch: Partial<BrandSettings>,
  updatedBy: string | null,
): Promise<BrandSettings> {
  const current = await getBrandSettings(database);
  const next: BrandSettings = {
    defaultBrand: isPlatformBrandId(patch.defaultBrand)
      ? patch.defaultBrand
      : current.defaultBrand,
    locked: typeof patch.locked === 'boolean' ? patch.locked : current.locked,
  };

  await database.db
    .insert(platformSettings)
    .values({
      key: BRAND_SETTINGS_KEY,
      value: JSON.stringify(next),
      updatedBy,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: platformSettings.key,
      set: {
        value: JSON.stringify(next),
        updatedBy,
        updatedAt: new Date(),
      },
    });

  return next;
}

export function resolveEffectiveBrand(
  settings: BrandSettings,
  personalBrand: string | undefined | null,
): PlatformBrandId {
  if (settings.locked) {
    return settings.defaultBrand;
  }
  return isPlatformBrandId(personalBrand)
    ? personalBrand
    : settings.defaultBrand;
}
