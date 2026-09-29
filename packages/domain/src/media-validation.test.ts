import { describe, expect, it } from 'vitest';
import {
  ALLOWED_MEDIA_TYPES,
  assertMediaBytesMatchContentType,
  isAllowedMediaType,
  sniffMediaContentType,
} from './media-validation.js';

describe('media-validation', () => {
  describe('isAllowedMediaType', () => {
    it('accepts valid image types', () => {
      expect(isAllowedMediaType('image/png')).toBe(true);
      expect(isAllowedMediaType('image/jpeg')).toBe(true);
      expect(isAllowedMediaType('image/gif')).toBe(true);
      expect(isAllowedMediaType('image/webp')).toBe(true);
    });

    it('rejects unsupported types', () => {
      expect(isAllowedMediaType('image/svg+xml')).toBe(false);
      expect(isAllowedMediaType('application/pdf')).toBe(false);
      expect(isAllowedMediaType('text/plain')).toBe(false);
      expect(isAllowedMediaType('video/mp4')).toBe(false);
    });
  });

  describe('sniffMediaContentType', () => {
    it('detects PNG from full 8-byte signature', () => {
      const png = new Uint8Array([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      ]);
      expect(sniffMediaContentType(png)).toBe('image/png');
    });

    it('detects JPEG from magic bytes', () => {
      const jpeg = new Uint8Array([
        0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
      ]);
      expect(sniffMediaContentType(jpeg)).toBe('image/jpeg');
    });

    it('detects GIF87a', () => {
      const gif87 = new Uint8Array([
        0x47, 0x49, 0x46, 0x38, 0x37, 0x61, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      ]);
      expect(sniffMediaContentType(gif87)).toBe('image/gif');
    });

    it('detects GIF89a', () => {
      const gif89 = new Uint8Array([
        0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      ]);
      expect(sniffMediaContentType(gif89)).toBe('image/gif');
    });

    it('detects WebP from RIFF...WEBP signature', () => {
      const webp = new Uint8Array([
        0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
      ]);
      expect(sniffMediaContentType(webp)).toBe('image/webp');
    });

    it('returns null for plain text', () => {
      const text = new Uint8Array(
        Buffer.from('This is plain text, not an image', 'utf8'),
      );
      expect(sniffMediaContentType(text)).toBe(null);
    });

    it('returns null for HTML', () => {
      const html = new Uint8Array(
        Buffer.from('<html><body>Not an image</body></html>', 'utf8'),
      );
      expect(sniffMediaContentType(html)).toBe(null);
    });

    it('returns null for truncated buffer', () => {
      const short = new Uint8Array([0x89, 0x50, 0x4e]);
      expect(sniffMediaContentType(short)).toBe(null);
    });

    it('returns null for empty buffer', () => {
      expect(sniffMediaContentType(new Uint8Array(0))).toBe(null);
    });

    it('rejects WebP with wrong subtype', () => {
      const badWebp = new Uint8Array([
        0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x58,
      ]);
      expect(sniffMediaContentType(badWebp)).toBe(null);
    });
  });

  describe('assertMediaBytesMatchContentType', () => {
    it('accepts matching PNG and returns canonical type', () => {
      const png = new Uint8Array([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      ]);
      const result = assertMediaBytesMatchContentType(png, 'image/png');
      expect(result).toBe('image/png');
    });

    it('accepts matching JPEG and returns canonical type', () => {
      const jpeg = new Uint8Array([
        0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
      ]);
      const result = assertMediaBytesMatchContentType(jpeg, 'image/jpeg');
      expect(result).toBe('image/jpeg');
    });

    it('accepts image/jpg and returns canonical image/jpeg', () => {
      const jpeg = new Uint8Array([
        0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
      ]);
      const result = assertMediaBytesMatchContentType(jpeg, 'image/jpg');
      expect(result).toBe('image/jpeg');
    });

    it('normalizes uppercase and whitespace', () => {
      const jpeg = new Uint8Array([
        0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
      ]);
      const result = assertMediaBytesMatchContentType(jpeg, ' IMAGE/JPEG ');
      expect(result).toBe('image/jpeg');
    });

    it('accepts matching GIF and returns canonical type', () => {
      const gif = new Uint8Array([
        0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      ]);
      const result = assertMediaBytesMatchContentType(gif, 'image/gif');
      expect(result).toBe('image/gif');
    });

    it('accepts matching WebP and returns canonical type', () => {
      const webp = new Uint8Array([
        0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
      ]);
      const result = assertMediaBytesMatchContentType(webp, 'image/webp');
      expect(result).toBe('image/webp');
    });

    it('rejects plain text declared as PNG', () => {
      const text = new Uint8Array(
        Buffer.from('This is plain text, not an image', 'utf8'),
      );
      try {
        assertMediaBytesMatchContentType(text, 'image/png');
        expect.fail('should have thrown');
      } catch (error: unknown) {
        expect(error).toHaveProperty('code', 'MEDIA_CONTENT_MISMATCH');
        expect(error).toHaveProperty('statusCode', 400);
      }
    });

    it('rejects HTML declared as JPEG', () => {
      const html = new Uint8Array(
        Buffer.from('<html><body>Not an image</body></html>', 'utf8'),
      );
      try {
        assertMediaBytesMatchContentType(html, 'image/jpeg');
        expect.fail('should have thrown');
      } catch (error: unknown) {
        expect(error).toHaveProperty('code', 'MEDIA_CONTENT_MISMATCH');
        expect(error).toHaveProperty('statusCode', 400);
      }
    });

    it('rejects PNG bytes declared as JPEG', () => {
      const png = new Uint8Array([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      ]);
      try {
        assertMediaBytesMatchContentType(png, 'image/jpeg');
        expect.fail('should have thrown');
      } catch (error: unknown) {
        expect(error).toHaveProperty('code', 'MEDIA_CONTENT_MISMATCH');
        expect(error).toHaveProperty('statusCode', 400);
        expect(error).toHaveProperty(
          'message',
          expect.stringMatching(/declared image\/jpeg.*matches image\/png/),
        );
      }
    });

    it('rejects JPEG bytes declared as PNG', () => {
      const jpeg = new Uint8Array([
        0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
      ]);
      try {
        assertMediaBytesMatchContentType(jpeg, 'image/png');
        expect.fail('should have thrown');
      } catch (error: unknown) {
        expect(error).toHaveProperty('code', 'MEDIA_CONTENT_MISMATCH');
        expect(error).toHaveProperty('statusCode', 400);
      }
    });

    it('rejects empty buffer', () => {
      try {
        assertMediaBytesMatchContentType(new Uint8Array(0), 'image/png');
        expect.fail('should have thrown');
      } catch (error: unknown) {
        expect(error).toHaveProperty('code', 'MEDIA_CONTENT_MISMATCH');
        expect(error).toHaveProperty('statusCode', 400);
        expect(error).toHaveProperty('message', expect.stringMatching(/empty/));
      }
    });

    it('rejects truncated buffer', () => {
      const short = new Uint8Array([0x89, 0x50, 0x4e]);
      try {
        assertMediaBytesMatchContentType(short, 'image/png');
        expect.fail('should have thrown');
      } catch (error: unknown) {
        expect(error).toHaveProperty('code', 'MEDIA_CONTENT_MISMATCH');
        expect(error).toHaveProperty('statusCode', 400);
        expect(error).toHaveProperty('message', expect.stringMatching(/too short/));
      }
    });

    it('rejects unsupported content type', () => {
      const svg = new Uint8Array(
        Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'utf8'),
      );
      try {
        assertMediaBytesMatchContentType(svg, 'image/svg+xml');
        expect.fail('should have thrown');
      } catch (error: unknown) {
        expect(error).toHaveProperty('code', 'MEDIA_TYPE_UNSUPPORTED');
        expect(error).toHaveProperty('statusCode', 400);
      }
    });

    it('rejects WebP with wrong subtype bytes', () => {
      const badWebp = new Uint8Array([
        0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x58,
      ]);
      try {
        assertMediaBytesMatchContentType(badWebp, 'image/webp');
        expect.fail('should have thrown');
      } catch (error: unknown) {
        expect(error).toHaveProperty('code', 'MEDIA_CONTENT_MISMATCH');
        expect(error).toHaveProperty('statusCode', 400);
      }
    });

    it('provides stable error code MEDIA_CONTENT_MISMATCH', () => {
      const text = new Uint8Array(Buffer.from('fake', 'utf8'));
      text[11] = 0;

      try {
        assertMediaBytesMatchContentType(text, 'image/png');
        expect.fail('should have thrown');
      } catch (error: unknown) {
        expect(error).toHaveProperty('code', 'MEDIA_CONTENT_MISMATCH');
        expect(error).toHaveProperty('statusCode', 400);
      }
    });
  });

  describe('ALLOWED_MEDIA_TYPES', () => {
    it('exports the correct list of allowed types', () => {
      expect(ALLOWED_MEDIA_TYPES).toEqual([
        'image/png',
        'image/jpeg',
        'image/gif',
        'image/webp',
      ]);
    });
  });
});
