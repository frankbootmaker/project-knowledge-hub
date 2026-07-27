import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import {
  fitLogoBox,
  prepareStylePackLogoForPrint,
  stylePackLogoImgHtml,
} from './style-pack-logo.js';

describe('style-pack-logo', () => {
  it('flattens transparent PNG pixels onto white', async () => {
    // 2x2: opaque red, fully transparent, opaque blue, half-transparent green
    const raw = Buffer.from([
      255, 0, 0, 255, 0, 0, 0, 0, 0, 0, 255, 255, 0, 255, 0, 128,
    ]);
    const png = await sharp(raw, {
      raw: { width: 2, height: 2, channels: 4 },
    })
      .png()
      .toBuffer();

    const prepared = await prepareStylePackLogoForPrint(png);
    expect(prepared.dataUri.startsWith('data:image/png;base64,')).toBe(true);
    expect(prepared.widthPx).toBe(2);
    expect(prepared.heightPx).toBe(2);

    const { data, info } = await sharp(
      Buffer.from(prepared.dataUri.split(',')[1]!, 'base64'),
    )
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    expect(info.channels).toBe(4);
    // Transparent pixel (1,0) becomes white.
    expect([...data.subarray(4, 8)]).toEqual([255, 255, 255, 255]);
    // Half-transparent green composites toward white.
    expect(data[12]).toBeGreaterThan(100);
    expect(data[13]).toBe(255);
    expect(data[14]).toBeGreaterThan(100);
    expect(data[15]).toBe(255);
  });

  it('fits logos into a max box without upscaling', () => {
    expect(fitLogoBox({ widthPx: 400, heightPx: 100 }, 90, 22)).toEqual({
      width: 88,
      height: 22,
    });
    expect(fitLogoBox({ widthPx: 40, heightPx: 10 }, 90, 22)).toEqual({
      width: 40,
      height: 10,
    });
  });

  it('emits explicit width/height on logo img tags', () => {
    const html = stylePackLogoImgHtml({
      dataUri: 'data:image/png;base64,aaa',
      widthPx: 200,
      heightPx: 100,
      maxWidth: 90,
      maxHeight: 22,
    });
    expect(html).toContain('width="44"');
    expect(html).toContain('height="22"');
    expect(html).toContain('background:transparent');
  });
});
