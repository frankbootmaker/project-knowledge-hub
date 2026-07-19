import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export function isAllowedAvatarContentType(value: string): boolean {
  return ALLOWED_TYPES.has(value);
}

export function resolveAvatarDir(uploadDir: string): string {
  return path.resolve(uploadDir);
}

export function avatarFilePath(uploadDir: string, userId: string): string {
  return path.join(resolveAvatarDir(uploadDir), userId);
}

export async function ensureAvatarDir(uploadDir: string): Promise<void> {
  await mkdir(resolveAvatarDir(uploadDir), { recursive: true });
}

export async function writeAvatarFile(
  uploadDir: string,
  userId: string,
  buffer: Buffer,
): Promise<void> {
  await ensureAvatarDir(uploadDir);
  await writeFile(avatarFilePath(uploadDir, userId), buffer);
}

export async function readAvatarFile(
  uploadDir: string,
  userId: string,
): Promise<Buffer | null> {
  try {
    return await readFile(avatarFilePath(uploadDir, userId));
  } catch {
    return null;
  }
}

export async function deleteAvatarFile(uploadDir: string, userId: string): Promise<void> {
  try {
    await unlink(avatarFilePath(uploadDir, userId));
  } catch {
    // missing file is fine
  }
}
