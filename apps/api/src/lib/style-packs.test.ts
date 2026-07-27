import { describe, expect, it } from 'vitest';
import {
  blankExportChrome,
  blankPublicStylePack,
  interpolateStyleTemplate,
  slugifyStylePackLabel,
  stylePackLogoBlobKey,
} from './style-packs.js';

describe('style-packs helpers', () => {
  it('exposes a synthetic Blank pack', () => {
    const pack = blankPublicStylePack();
    expect(pack.id).toBe('blank');
    expect(pack.builtin).toBe(true);
    expect(pack.formats).toEqual(['pdf', 'docx']);
  });

  it('builds Blank export chrome without a logo', () => {
    const chrome = blankExportChrome();
    expect(chrome.id).toBe('blank');
    expect(chrome.logoDataUri).toBeNull();
    expect(chrome.chrome.showLogo).toBe(false);
  });

  it('slugifies labels for new packs', () => {
    expect(slugifyStylePackLabel('Corporate Letterhead')).toBe(
      'corporate-letterhead',
    );
  });

  it('interpolates header/footer templates', () => {
    expect(
      interpolateStyleTemplate('{title} · p{page}/{pages}', {
        title: 'Q3 Report',
        page: '2',
        pages: '10',
      }),
    ).toBe('Q3 Report · p2/10');
  });

  it('builds doc-templates blob keys', () => {
    expect(
      stylePackLogoBlobKey(
        '00000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000002',
        'png',
      ),
    ).toBe(
      'doc-templates/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000002/logo.png',
    );
  });
});
