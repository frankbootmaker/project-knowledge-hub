import { describe, expect, it } from 'vitest';
import {
  rewriteAttachmentPlaceholders,
  sanitizePgText,
  titleFromImport,
} from './rewrite.js';

describe('rewriteAttachmentPlaceholders', () => {
  it('rewrites attachment:N tokens to media URLs', () => {
    const md = 'See ![a](attachment:0) and ![b](attachment:1)';
    const map = new Map([
      [0, { id: 'm1', filename: 'a.png' }],
      [1, { id: 'm2', filename: 'b.png' }],
    ]);
    expect(rewriteAttachmentPlaceholders(md, map)).toBe(
      'See ![a](/api/v1/media/m1) and ![b](/api/v1/media/m2)',
    );
  });
});

describe('titleFromImport', () => {
  it('prefers titleHint', () => {
    expect(
      titleFromImport({ titleHint: 'Report', originalFilename: 'x.pdf' }),
    ).toBe('Report');
  });
});

describe('sanitizePgText', () => {
  it('strips null bytes from PDF extract text', () => {
    expect(sanitizePgText('8CG7WD7Q\u00000010')).toBe('8CG7WD7Q0010');
  });
});
