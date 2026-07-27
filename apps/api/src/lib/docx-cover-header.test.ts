import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import sharp from 'sharp';
import { buildKnowledgeRecordDocx } from './knowledge-export.js';

async function sampleLogoDataUri(): Promise<{
  logoDataUri: string;
  logoWidthPx: number;
  logoHeightPx: number;
}> {
  const logoPng = await sharp({
    create: {
      width: 120,
      height: 40,
      channels: 4,
      background: { r: 200, g: 16, b: 46, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
  return {
    logoDataUri: `data:image/png;base64,${logoPng.toString('base64')}`,
    logoWidthPx: 120,
    logoHeightPx: 40,
  };
}

describe('docx cover vs running header', () => {
  it('keeps header/footer text on page 1 and omits header logo when cover brand is on', async () => {
    const logo = await sampleLogoDataUri();
    const docx = await buildKnowledgeRecordDocx({
      title: 'Preview Bootmaker Template',
      slug: 'preview-bootmaker',
      summary: null,
      recordType: 'note',
      lifecycleStatus: 'active',
      contentMarkdown: '# Section\n\nHello.',
      stylePack: {
        id: 'pack-1',
        label: 'Bootmaker',
        typography: {
          bodyFont: 'Calibri',
          headingFont: 'Calibri',
          monoFont: 'Consolas',
          bodyColor: '#1A1A1A',
          headingColor: '#111111',
          mutedColor: '#5A6270',
        },
        chrome: {
          headerText: 'Bootmaker Kft',
          footerText: 'Confidential footer',
          disclaimer: '',
          showLogo: true,
          showCoverBrand: true,
          marginTopMm: 14,
          marginBottomMm: 14,
          marginLeftMm: 12,
          marginRightMm: 12,
        },
        ...logo,
      },
    });

    const zip = await JSZip.loadAsync(docx);
    const docXml = await zip.file('word/document.xml')!.async('string');
    expect(docXml).not.toMatch(/<w:titlePg\s*\/>|<w:titlePg\/>/);

    const bodyImages = (docXml.match(/w:drawing/g) || []).length;
    expect(bodyImages).toBeGreaterThan(0);

    const headerXml = await zip.file('word/header1.xml')!.async('string');
    expect(headerXml).toContain('Bootmaker Kft');
    expect(headerXml).not.toMatch(/blip/);

    const footerXml = await zip.file('word/footer1.xml')!.async('string');
    expect(footerXml).toContain('Confidential footer');
    expect(footerXml).not.toContain('Preview Bootmaker Template');
  });

  it('puts the logo in the running header when cover brand is off', async () => {
    const logo = await sampleLogoDataUri();
    const docx = await buildKnowledgeRecordDocx({
      title: 'No Cover',
      slug: 'no-cover',
      summary: null,
      recordType: 'note',
      lifecycleStatus: 'active',
      contentMarkdown: 'Hello.',
      stylePack: {
        id: 'pack-2',
        label: 'Header Only',
        typography: {
          bodyFont: 'Calibri',
          headingFont: 'Calibri',
          monoFont: 'Consolas',
          bodyColor: '#1A1A1A',
          headingColor: '#111111',
          mutedColor: '#5A6270',
        },
        chrome: {
          headerText: 'Running Header',
          footerText: 'Custom footer',
          disclaimer: '',
          showLogo: true,
          showCoverBrand: false,
          marginTopMm: 14,
          marginBottomMm: 14,
          marginLeftMm: 12,
          marginRightMm: 12,
        },
        ...logo,
      },
    });

    const zip = await JSZip.loadAsync(docx);
    const docXml = await zip.file('word/document.xml')!.async('string');
    expect(docXml).not.toMatch(/<w:titlePg\s*\/>|<w:titlePg\/>/);

    const headerXml = await zip.file('word/header1.xml')!.async('string');
    expect(headerXml).toContain('Running Header');
    expect(headerXml).toMatch(/blip/);

    const footerXml = await zip.file('word/footer1.xml')!.async('string');
    expect(footerXml).toContain('Custom footer');
  });
});
