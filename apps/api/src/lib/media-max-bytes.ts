import { eq } from 'drizzle-orm';
import { platformSettings, type Database } from '@project-knowledge-hub/database';
import { AppError } from '@project-knowledge-hub/domain';

export const MEDIA_MAX_BYTES_SETTING_KEY = 'media_max_bytes';

export async function getEffectiveMediaMaxBytes(
  database: Database,
  ceiling: number,
): Promise<number> {
  const [row] = await database.db
    .select({ value: platformSettings.value })
    .from(platformSettings)
    .where(eq(platformSettings.key, MEDIA_MAX_BYTES_SETTING_KEY))
    .limit(1);
  if (!row) return ceiling;
  const parsed = Number(row.value);
  if (!Number.isInteger(parsed) || parsed < 1) return ceiling;
  return Math.min(parsed, ceiling);
}

export async function setMediaMaxBytes(
  database: Database,
  input: { maxBytes: number; ceiling: number; updatedBy: string },
): Promise<number> {
  if (!Number.isInteger(input.maxBytes) || input.maxBytes < 1) {
    throw new AppError({
      code: 'VALIDATION_ERROR',
      message: 'Max upload size must be a positive number of bytes',
      statusCode: 400,
    });
  }
  if (input.maxBytes > input.ceiling) {
    throw new AppError({
      code: 'MEDIA_LIMIT_EXCEEDS_CEILING',
      message: `Max upload size cannot exceed ${input.ceiling} bytes`,
      statusCode: 400,
    });
  }
  await database.db
    .insert(platformSettings)
    .values({
      key: MEDIA_MAX_BYTES_SETTING_KEY,
      value: String(input.maxBytes),
      updatedBy: input.updatedBy,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: platformSettings.key,
      set: {
        value: String(input.maxBytes),
        updatedBy: input.updatedBy,
        updatedAt: new Date(),
      },
    });
  return input.maxBytes;
}
