import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import {
  MCP_MEDIA_MAX_BYTES,
  MCP_MEDIA_MAX_EDGE_PX,
  mediaReadPlan,
  prepareWorkspaceMediaImage,
} from './media-read-image.js';

async function solidPng(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 20, g: 40, b: 80 },
    },
  })
    .png()
    .toBuffer();
}

describe('prepareWorkspaceMediaImage', () => {
  it('leaves a small raster unchanged', async () => {
    const png = await solidPng(8, 8);
    const prepared = await prepareWorkspaceMediaImage(png, 'image/png');
    expect(prepared.imageIncluded).toBe(true);
    if (!prepared.imageIncluded) return;
    expect(prepared.resized).toBe(false);
    expect(prepared.mimeType).toBe('image/png');
    expect(prepared.width).toBe(8);
    expect(prepared.height).toBe(8);
    expect(prepared.buffer.equals(png)).toBe(true);
  });

  it('downscales a large image and does not upscale', async () => {
    const width = 1800;
    const height = 1200;
    const raw = randomBytes(width * height * 3);
    const png = await sharp(raw, { raw: { width, height, channels: 3 } })
      .png()
      .toBuffer();
    expect(Math.max(width, height)).toBeGreaterThan(MCP_MEDIA_MAX_EDGE_PX);

    const prepared = await prepareWorkspaceMediaImage(png, 'image/png');
    expect(prepared.imageIncluded).toBe(true);
    if (!prepared.imageIncluded) return;
    expect(prepared.resized).toBe(true);
    expect(Math.max(prepared.width, prepared.height)).toBeLessThanOrEqual(MCP_MEDIA_MAX_EDGE_PX);
    expect(prepared.buffer.byteLength).toBeLessThanOrEqual(MCP_MEDIA_MAX_BYTES);
    expect(prepared.width).toBeLessThan(width);
    expect(prepared.height).toBeLessThan(height);

    const small = await solidPng(8, 8);
    const capped = await prepareWorkspaceMediaImage(small, 'image/png', 1568);
    expect(capped.imageIncluded).toBe(true);
    if (!capped.imageIncluded) return;
    expect(capped.width).toBe(8);
    expect(capped.height).toBe(8);
    expect(capped.resized).toBe(false);
  });

  it('honors a smaller maxDimension without enlarging', async () => {
    const png = await solidPng(400, 200);
    const prepared = await prepareWorkspaceMediaImage(png, 'image/png', 100);
    expect(prepared.imageIncluded).toBe(true);
    if (!prepared.imageIncluded) return;
    expect(prepared.resized).toBe(true);
    expect(Math.max(prepared.width, prepared.height)).toBeLessThanOrEqual(100);
    expect(prepared.width).toBeGreaterThan(prepared.height);
  });

  it('returns metadata only for non-images and SVG', async () => {
    const pdf = await prepareWorkspaceMediaImage(Buffer.from('%PDF-1.4'), 'application/pdf');
    expect(pdf).toEqual({ imageIncluded: false, reason: 'not_image' });
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    const prepared = await prepareWorkspaceMediaImage(svg, 'image/svg+xml');
    expect(prepared).toEqual({ imageIncluded: false, reason: 'svg' });
  });

  it('flattens an animated GIF to a single frame', async () => {
    const red = await sharp({
      create: { width: 4, height: 4, channels: 3, background: { r: 255, g: 0, b: 0 } },
    })
      .png()
      .toBuffer();
    const blue = await sharp({
      create: { width: 4, height: 4, channels: 3, background: { r: 0, g: 0, b: 255 } },
    })
      .png()
      .toBuffer();
    const gif = await sharp([red, blue], { join: { animated: true } })
      .gif()
      .toBuffer();
    const source = await sharp(gif, { animated: true }).metadata();
    expect(source.pages).toBeGreaterThan(1);

    const prepared = await prepareWorkspaceMediaImage(gif, 'image/gif');
    expect(prepared.imageIncluded).toBe(true);
    if (!prepared.imageIncluded) return;
    expect(prepared.resized).toBe(true);
    expect(prepared.mimeType).toBe('image/jpeg');
    const out = await sharp(prepared.buffer).metadata();
    expect(out.pages ?? 1).toBe(1);
    expect(Math.max(prepared.width, prepared.height)).toBeLessThanOrEqual(8);
  });

  it('plans animated rasters for a single-frame encode', () => {
    expect(
      mediaReadPlan({
        contentType: 'image/gif',
        width: 8,
        height: 8,
        pages: 2,
        byteLength: 100,
      }),
    ).toBe('raster');
    expect(
      mediaReadPlan({
        contentType: 'image/gif',
        width: 8,
        height: 8,
        pages: 1,
        byteLength: 100,
      }),
    ).toBe('unchanged');
    expect(
      mediaReadPlan({
        contentType: 'image/svg+xml',
        width: 8,
        height: 8,
        pages: 1,
        byteLength: 100,
      }),
    ).toBe('metadata');
  });
});
