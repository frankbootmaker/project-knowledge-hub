import ExcelJS from 'exceljs';
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

  it('builds a non-empty DOCX from rendered HTML', async () => {
    const docx = await buildKnowledgeRecordDocx(sample);
    expect(docx.byteLength).toBeGreaterThan(1000);
    expect(docx[0]).toBe(0x50);
    expect(docx[1]).toBe(0x4b);
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

  it('builds a PDFKit fallback PDF', async () => {
    const pdf = await buildKnowledgeRecordPdfWithPdfkit(sample);
    expect(pdf.byteLength).toBeGreaterThan(500);
    expect(pdf.subarray(0, 4).toString('utf8')).toBe('%PDF');
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
