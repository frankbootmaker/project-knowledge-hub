import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import {
  buildStarterDocxTemplate,
  detectDocxBodyAnchor,
  extractBodyBlocks,
  injectBodyIntoDocumentXml,
  mergeHtmlDocxIntoShell,
  validateDocxTemplateBuffer,
} from './docx-template.js';

describe('docx-template', () => {
  it('builds a starter template with a PKH_BODY anchor', async () => {
    const buffer = await buildStarterDocxTemplate();
    const anchor = await validateDocxTemplateBuffer(buffer);
    expect(anchor).toBe('contentControl');

    const zip = await JSZip.loadAsync(buffer);
    const documentXml = await zip.file('word/document.xml')!.async('string');
    expect(detectDocxBodyAnchor(documentXml)).toBe('contentControl');
    expect(documentXml).toContain('{title}');
  });

  it('rejects templates without a body anchor', async () => {
    const zip = new JSZip();
    zip.file(
      'word/document.xml',
      `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>No anchor</w:t></w:r></w:p></w:body></w:document>`,
    );
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    await expect(validateDocxTemplateBuffer(buffer)).rejects.toMatchObject({
      code: 'STYLE_PACK_DOCX_TEMPLATE_NO_BODY',
    });
  });

  it('merges body blocks and interpolates tokens into the shell', async () => {
    const templateBuffer = await buildStarterDocxTemplate();
    const bodyZip = new JSZip();
    bodyZip.file(
      'word/document.xml',
      `<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Injected paragraph</w:t></w:r></w:p>
    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr>
  </w:body>
</w:document>`,
    );
    const bodyDocxBuffer = await bodyZip.generateAsync({ type: 'nodebuffer' });

    const merged = await mergeHtmlDocxIntoShell({
      templateBuffer,
      bodyDocxBuffer,
      vars: {
        title: 'AMAE Brief',
        date: '2026-07-27',
        datetime: '2026.07.27 19:25 UTC',
        slug: 'amae-brief',
        type: 'Leltár',
        status: 'Aktuális',
      },
    });

    const zip = await JSZip.loadAsync(merged);
    const documentXml = await zip.file('word/document.xml')!.async('string');
    expect(documentXml).toContain('Injected paragraph');
    expect(documentXml).toContain('AMAE Brief');
    expect(documentXml).not.toContain('{{body}}');

    const footerXml = await zip.file('word/footer1.xml')!.async('string');
    expect(footerXml).toContain('AMAE Brief');
    expect(footerXml).toContain('2026-07-27');
  });

  it('extracts body blocks without sectPr', () => {
    const blocks = extractBodyBlocks(`
      <w:document><w:body>
        <w:p><w:r><w:t>Hi</w:t></w:r></w:p>
        <w:sectPr><w:pgSz w:w="1" w:h="1"/></w:sectPr>
      </w:body></w:document>
    `);
    expect(blocks).toContain('Hi');
    expect(blocks).not.toContain('sectPr');
  });

  it('injects into a {{body}} placeholder paragraph', () => {
    const xml = `<w:body><w:p><w:r><w:t>before</w:t></w:r></w:p><w:p><w:r><w:t>{{body}}</w:t></w:r></w:p></w:body>`;
    const next = injectBodyIntoDocumentXml(
      xml,
      '<w:p><w:r><w:t>NEW</w:t></w:r></w:p>',
      'placeholder',
    );
    expect(next).toContain('NEW');
    expect(next).not.toContain('{{body}}');
  });
});
