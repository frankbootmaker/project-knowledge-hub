/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from 'vitest';
import { isImageContentType, mediaAbsoluteUrl } from './media-image';

describe('media-image', () => {
  it('detects image content types', () => {
    expect(isImageContentType('image/png')).toBe(true);
    expect(isImageContentType('IMAGE/JPEG')).toBe(true);
    expect(isImageContentType('application/pdf')).toBe(false);
  });

  it('builds absolute media URLs', () => {
    expect(mediaAbsoluteUrl('https://cdn.test/x.png')).toBe(
      'https://cdn.test/x.png',
    );
    expect(mediaAbsoluteUrl('/api/v1/media/1')).toBe(
      'http://localhost:3000/api/v1/media/1',
    );
  });
});
