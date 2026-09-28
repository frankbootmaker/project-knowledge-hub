import { AppError } from './index.js';

/**
 * Allowed image types for workspace media uploads.
 * PNG, JPEG, GIF, and WebP are supported.
 */
export const ALLOWED_MEDIA_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
] as const;

export type AllowedMediaType = (typeof ALLOWED_MEDIA_TYPES)[number];

/**
 * Check if a content type string is an allowed media type.
 */
export function isAllowedMediaType(contentType: string): contentType is AllowedMediaType {
  return ALLOWED_MEDIA_TYPES.includes(contentType as AllowedMediaType);
}

/**
 * Sniff the actual content type from the magic bytes at the start of a buffer.
 * Returns the detected content type or null if no recognized signature is found.
 *
 * Checks signatures for:
 * - PNG: full 8-byte signature `89 50 4E 47 0D 0A 1A 0A`
 * - JPEG: `FF D8 FF` (followed by various markers)
 * - GIF: `GIF87a` or `GIF89a`
 * - WebP: `RIFF....WEBP` (checking bytes 0-3 and 8-11)
 */
export function sniffMediaContentType(bytes: Uint8Array): string | null {
  if (bytes.length < 12) {
    return null;
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }

  // GIF: "GIF87a" or "GIF89a"
  if (
    bytes[0] === 0x47 && // G
    bytes[1] === 0x49 && // I
    bytes[2] === 0x46 && // F
    bytes[3] === 0x38 && // 8
    (bytes[4] === 0x37 || bytes[4] === 0x39) && // 7 or 9
    bytes[5] === 0x61 // a
  ) {
    return 'image/gif';
  }

  // WebP: RIFF....WEBP (bytes 0-3: RIFF, bytes 8-11: WEBP)
  if (
    bytes[0] === 0x52 && // R
    bytes[1] === 0x49 && // I
    bytes[2] === 0x46 && // F
    bytes[3] === 0x46 && // F
    bytes[8] === 0x57 && // W
    bytes[9] === 0x45 && // E
    bytes[10] === 0x42 && // B
    bytes[11] === 0x50 // P
  ) {
    return 'image/webp';
  }

  return null;
}

/**
 * Normalize common variants of content type strings.
 * Treats image/jpg as image/jpeg.
 */
function normalizeContentType(contentType: string): string {
  const normalized = contentType.toLowerCase().trim();
  if (normalized === 'image/jpg') {
    return 'image/jpeg';
  }
  return normalized;
}

/**
 * Assert that the bytes match the declared content type and return the canonical type.
 * Normalizes image/jpg to image/jpeg, lowercases, and trims.
 * Throws AppError with code MEDIA_CONTENT_MISMATCH if bytes don't match the declared type.
 *
 * @param bytes - The file bytes to check
 * @param declaredContentType - The content type declared by the client
 * @returns The canonical AllowedMediaType to store
 * @throws {AppError} with code MEDIA_CONTENT_MISMATCH if bytes don't match the declared type
 */
export function assertMediaBytesMatchContentType(
  bytes: Uint8Array,
  declaredContentType: string,
): AllowedMediaType {
  const normalized = normalizeContentType(declaredContentType);

  if (!isAllowedMediaType(normalized)) {
    throw new AppError({
      code: 'MEDIA_TYPE_UNSUPPORTED',
      message: `Content type ${declaredContentType} is not supported. Allowed types: ${ALLOWED_MEDIA_TYPES.join(', ')}`,
      statusCode: 400,
    });
  }

  if (bytes.length === 0) {
    throw new AppError({
      code: 'MEDIA_CONTENT_MISMATCH',
      message: 'Media bytes are empty',
      statusCode: 400,
    });
  }

  if (bytes.length < 12) {
    throw new AppError({
      code: 'MEDIA_CONTENT_MISMATCH',
      message: 'Media bytes are too short to determine content type',
      statusCode: 400,
    });
  }

  const sniffed = sniffMediaContentType(bytes);

  if (!sniffed) {
    throw new AppError({
      code: 'MEDIA_CONTENT_MISMATCH',
      message: `Content does not match any supported image format. Declared: ${declaredContentType}`,
      statusCode: 400,
    });
  }

  if (sniffed !== normalized) {
    throw new AppError({
      code: 'MEDIA_CONTENT_MISMATCH',
      message: `Content type mismatch: declared ${declaredContentType}, but bytes signature matches ${sniffed}`,
      statusCode: 400,
    });
  }

  return normalized;
}
