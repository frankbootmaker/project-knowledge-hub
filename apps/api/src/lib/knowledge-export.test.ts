import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { afterAll, describe, expect, it } from 'vitest';
import {
  buildExportHtmlDocument,
  buildKnowledgeMarkdownExport,
  buildKnowledgeRecordDocx,
  buildKnowledgeRecordPdf,
  buildKnowledgeRecordPdfWithPdfkit,
  buildKnowledgeRecordXlsx,
  knowledgeExportFilename,
} from './knowledge-export.js';

const sample = {
  title: 'Annual Dividend Summary',
  slug: 'annual-dividend-summary',
  summary: 'Net dividends by year',
  recordType: 'note',
  lifecycleStatus: 'draft',
  contentMarkdown: [
    '# Overview',
    '',
    'This is a **summary** with a [link](https://example.com).',
    '',
    '## Figures',
    '',
    '| Year | Amount |',
    '| --- | --- |',
    '| 2024 | 10 |',
    '| 2025 | 12 |',
    '',
    '- Item one',
    '- Item two',
    '',
    '```ts',
    'const x = 1;',
    '```',
    '',
    '> A quote',
    '',
  ].join('\n'),
  exportedAt: new Date('2026-07-26T12:00:00.000Z'),
  webUrl: 'https://knowhub.example.com',
};

async function readDocumentXml(docx: Buffer): Promise<string> {
  const archive = await JSZip.loadAsync(docx);
  return archive.file('word/document.xml')?.async('string') ?? '';
}

describe('knowledge-export', () => {
  it('builds a safe filename', () => {
    expect(knowledgeExportFilename('Annual Dividend!', 'pdf')).toBe(
      'Annual-Dividend.pdf',
    );
    expect(knowledgeExportFilename('Annual Dividend!', 'xlsx')).toBe(
      'Annual-Dividend.xlsx',
    );
  });

  it('builds markdown with front matter', () => {
    const md = buildKnowledgeMarkdownExport(sample);
    expect(md).toContain('title: "Annual Dividend Summary"');
    expect(md).toContain('## Figures');
  });

  it('builds an HTML document from rendered markdown', async () => {
    const html = await buildExportHtmlDocument(sample);
    expect(html).toContain('class="knowledge-markdown"');
    expect(html).toContain('<strong>summary</strong>');
    expect(html).toContain('<table>');
    expect(html).toContain('<th>');
    expect(html).toMatch(/language-ts|hljs/);
  });

  it('builds a formatted DOCX that mirrors the rendered markdown', async () => {
    const docx = await buildKnowledgeRecordDocx(sample);
    expect(docx.byteLength).toBeGreaterThan(1000);
    expect(docx[0]).toBe(0x50);
    expect(docx[1]).toBe(0x4b);

    const xml = await readDocumentXml(docx);
    // A malformed declaration makes Word refuse the whole document.
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>')).toBe(
      true,
    );
    expect(xml).toContain('w:orient="portrait"');
    expect(xml).toContain('<w:trPr><w:cantSplit/><w:tblHeader/></w:trPr>');
    expect(xml).toContain('<w:tblBorders>');
    expect(xml).toContain('w:fill="F1F3F5"');
    expect(xml).toContain('<w:tblHeader/>');
    expect(xml).toContain('Heading1');
    expect(xml).toContain('<w:numPr>');
    expect(xml).toContain('w:ascii="Consolas"');
    // Word rejects fractional measurements as corrupt content.
    expect(xml).not.toMatch(/\sw:\w+="\d+\.\d+"/);
    expect(xml).not.toContain('| Year | Amount |');
  });

  it('turns the DOCX landscape for spreadsheet-wide tables', async () => {
    const headers = Array.from({ length: 14 }, (_, index) => `Metric ${index + 1}`);
    const docx = await buildKnowledgeRecordDocx({
      ...sample,
      contentMarkdown: [
        '## Wide',
        '',
        `| ${headers.join(' | ')} |`,
        `| ${headers.map(() => '---').join(' | ')} |`,
        `| ${headers.map((_, index) => `1 250 00${index}`).join(' | ')} |`,
      ].join('\n'),
    });

    expect(await readDocumentXml(docx)).toContain('w:orient="landscape"');
  });

  it('builds a structured XLSX workbook with typed table cells', async () => {
    const xlsx = await buildKnowledgeRecordXlsx(sample);
    expect(xlsx[0]).toBe(0x50);
    expect(xlsx[1]).toBe(0x4b);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(xlsx);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      'Document',
      'Figures',
      'Record',
    ]);

    const figures = workbook.getWorksheet('Figures');
    expect(figures?.getRow(1).values).toEqual([undefined, 'Year', 'Amount']);
    expect(figures?.getCell('A2').value).toBe(2024);
    expect(figures?.getCell('B2').value).toBe(10);
    expect(figures?.getCell('B2').numFmt).toBe('#,##0');

    const document = workbook.getWorksheet('Document');
    const documentText = (document?.getColumn(1).values ?? [])
      .filter((value): value is string => typeof value === 'string')
      .join('\n');
    expect(documentText).toContain('Annual Dividend Summary');
    expect(documentText).toContain('Figures');
    expect(documentText).toContain('• Item one');
    expect(documentText).not.toContain('| Year | Amount |');
    expect(documentText).not.toContain('**summary**');
  });

  it('drops synthetic Column N headers from imported grids', async () => {
    const xlsx = await buildKnowledgeRecordXlsx({
      ...sample,
      contentMarkdown: [
        '## Grid',
        '',
        '| Column 1 | Column 2 |',
        '| --- | --- |',
        '| Felhasznált | 1 250 000 Ft |',
      ].join('\n'),
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(xlsx);
    const grid = workbook.getWorksheet('Grid');
    expect(grid?.getCell('A1').value).toBe('Felhasznált');
    expect(grid?.getCell('B1').value).toBe(1250000);
    expect(grid?.getCell('B1').numFmt).toBe('#,##0 "Ft"');
  });

  it('builds a laid-out PDF without Chromium', async () => {
    const pdf = await buildKnowledgeRecordPdfWithPdfkit(sample);
    expect(pdf.byteLength).toBeGreaterThan(500);
    expect(pdf.subarray(0, 4).toString('utf8')).toBe('%PDF');

    const raw = pdf.toString('latin1');
    expect(raw).toContain('MediaBox [0 0 595.28 841.89]');
    // Table cells are drawn, so the Markdown pipe syntax never reaches the page.
    expect(raw).not.toContain('| Year | Amount |');
  });

  it('turns to landscape for spreadsheet-wide tables', async () => {
    const headers = Array.from({ length: 14 }, (_, index) => `Metric ${index + 1}`);
    const row = Array.from({ length: 14 }, (_, index) => `1 250 00${index}`);
    const pdf = await buildKnowledgeRecordPdfWithPdfkit({
      ...sample,
      contentMarkdown: [
        '## Wide',
        '',
        `| ${headers.join(' | ')} |`,
        `| ${headers.map(() => '---').join(' | ')} |`,
        `| ${row.join(' | ')} |`,
      ].join('\n'),
    });

    expect(pdf.toString('latin1')).toContain('MediaBox [0 0 841.89 595.28]');
  });

  it(
    'builds a non-empty PDF (Puppeteer or PDFKit fallback)',
    async () => {
      const pdf = await buildKnowledgeRecordPdf(sample);
      expect(pdf.byteLength).toBeGreaterThan(500);
      expect(pdf.subarray(0, 4).toString('utf8')).toBe('%PDF');
    },
    90_000,
  );
});

afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 100));
});
