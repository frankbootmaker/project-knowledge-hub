import sharp from 'sharp';

/** Longest side returned to MCP clients. Never upscale past the source. */
export const MCP_MEDIA_MAX_EDGE_PX = 1568;

/** Encoded image cap, about 1 MB. */
export const MCP_MEDIA_MAX_BYTES = 1_000_000;

const RASTER_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

export type PreparedMediaImage =
  | { imageIncluded: false; reason: 'not_image' | 'svg' | 'unreadable' }
  | {
      imageIncluded: true;
      buffer: Buffer;
      mimeType: string;
      width: number;
      height: number;
      resized: boolean;
    };

type OutputMime = 'image/jpeg' | 'image/png' | 'image/webp';

function clampEdge(maxDimension: number | undefined): number {
  if (maxDimension == null || !Number.isFinite(maxDimension)) {
    return MCP_MEDIA_MAX_EDGE_PX;
  }
  const rounded = Math.floor(maxDimension);
  if (rounded < 1) return 1;
  return Math.min(rounded, MCP_MEDIA_MAX_EDGE_PX);
}

function canonicalType(contentType: string): string {
  const base = contentType.toLowerCase().split(';')[0]?.trim() ?? '';
  return base === 'image/jpg' ? 'image/jpeg' : base;
}

/**
 * Whether a raster must be re-encoded. Animated images are always flattened.
 * SVG and non-images never enter the encoder.
 */
export function mediaReadPlan(input: {
  contentType: string;
  width: number;
  height: number;
  pages: number;
  byteLength: number;
  maxDimension?: number;
}): 'metadata' | 'unchanged' | 'raster' {
  const type = canonicalType(input.contentType);
  if (type === 'image/svg+xml' || type === 'image/svg') return 'metadata';
  if (!RASTER_TYPES.has(type)) return 'metadata';
  if (input.width < 1 || input.height < 1) return 'metadata';
  const edge = clampEdge(input.maxDimension);
  const animated = input.pages > 1;
  const longest = Math.max(input.width, input.height);
  if (!animated && longest <= edge && input.byteLength <= MCP_MEDIA_MAX_BYTES) {
    return 'unchanged';
  }
  return 'raster';
}

async function encodeFit(
  buffer: Buffer,
  edge: number,
  mime: OutputMime,
  quality: number,
): Promise<{ buffer: Buffer; width: number; height: number; mimeType: OutputMime }> {
  let pipeline = sharp(buffer, {
    failOn: 'none',
    pages: 1,
    animated: false,
  }).rotate();
  pipeline = pipeline.resize({
    width: edge,
    height: edge,
    fit: 'inside',
    withoutEnlargement: true,
  });
  if (mime === 'image/jpeg') {
    pipeline = pipeline
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .jpeg({ quality, mozjpeg: true });
  } else if (mime === 'image/webp') {
    pipeline = pipeline.webp({ quality });
  } else {
    pipeline = pipeline.png({ compressionLevel: 9 });
  }
  const out = await pipeline.toBuffer({ resolveWithObject: true });
  return {
    buffer: out.data,
    width: out.info.width,
    height: out.info.height,
    mimeType: mime,
  };
}

function initialMime(type: string, animated: boolean, byteLength: number): OutputMime {
  if (animated) return 'image/jpeg';
  if (type === 'image/jpeg') return 'image/jpeg';
  if (type === 'image/webp') return 'image/webp';
  if (type === 'image/png' && byteLength <= MCP_MEDIA_MAX_BYTES) return 'image/png';
  return 'image/jpeg';
}

/**
 * Prepare bytes for an MCP image content block.
 * Small rasters are returned unchanged. Larger ones are scaled so the longest
 * side is at most 1568 px (or maxDimension, when smaller) and at most ~1 MB.
 * Never upscales. Animated GIF/WebP becomes the first frame. SVG is metadata only.
 */
export async function prepareWorkspaceMediaImage(
  buffer: Buffer,
  contentType: string,
  maxDimension?: number,
): Promise<PreparedMediaImage> {
  const type = canonicalType(contentType);
  if (type === 'image/svg+xml' || type === 'image/svg') {
    return { imageIncluded: false, reason: 'svg' };
  }
  if (!RASTER_TYPES.has(type)) {
    return { imageIncluded: false, reason: 'not_image' };
  }

  let meta;
  try {
    meta = await sharp(buffer, { failOn: 'none', animated: true }).metadata();
  } catch {
    return { imageIncluded: false, reason: 'unreadable' };
  }
  if (meta.format === 'svg') {
    return { imageIncluded: false, reason: 'svg' };
  }
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  const pages = meta.pages ?? 1;
  const plan = mediaReadPlan({
    contentType: type,
    width,
    height,
    pages,
    byteLength: buffer.byteLength,
    maxDimension,
  });
  if (plan === 'metadata') {
    return { imageIncluded: false, reason: 'unreadable' };
  }
  if (plan === 'unchanged') {
    return {
      imageIncluded: true,
      buffer,
      mimeType: type,
      width,
      height,
      resized: false,
    };
  }

  const edgeCap = clampEdge(maxDimension);
  const longest = Math.max(width, height);
  const animated = pages > 1;
  let mime = initialMime(type, animated, buffer.byteLength);
  let edge = Math.min(edgeCap, longest);
  let quality = 80;
  let encoded = await encodeFit(buffer, edge, mime, quality);

  const fits = () =>
    encoded.buffer.byteLength <= MCP_MEDIA_MAX_BYTES &&
    Math.max(encoded.width, encoded.height) <= edgeCap;

  for (let attempt = 0; attempt < 12 && !fits(); attempt += 1) {
    if (mime === 'image/png') {
      mime = 'image/jpeg';
      quality = 75;
    } else if (quality > 45) {
      quality -= 10;
    } else {
      edge = Math.max(64, Math.floor(edge * 0.75));
      quality = 70;
    }
    encoded = await encodeFit(buffer, edge, mime, quality);
  }
  while (encoded.buffer.byteLength > MCP_MEDIA_MAX_BYTES && edge > 32) {
    edge = Math.max(32, Math.floor(edge * 0.7));
    mime = 'image/jpeg';
    encoded = await encodeFit(buffer, edge, mime, 50);
  }

  return {
    imageIncluded: true,
    buffer: encoded.buffer,
    mimeType: encoded.mimeType,
    width: encoded.width,
    height: encoded.height,
    resized: true,
  };
}
