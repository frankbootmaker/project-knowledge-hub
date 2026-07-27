import ExcelJS from 'exceljs';
import puppeteer, { type Browser, type PDFOptions } from 'puppeteer';
import { renderMarkdown } from '@project-knowledge-hub/markdown';
import htmlToDocxImport from '@turbodocx/html-to-docx';
import {
  buildDocxDocumentHtml,
  buildDocxDocumentOptions,
  buildDocxFooterHtml,
  buildDocxHeaderHtml,
  decodeHtmlEntities,
  finalizeDocxPackage,
  inlineImageDataUris,
  mermaidFallbackHtml,
  mermaidImageHtml,
  replaceMermaidBlocks,
  styleMarkdownHtmlForDocx,
  type DocxImage,
} from './docx-document.js';
import {
  coerceSpreadsheetValue,
  parseMarkdownBlocks,
  type MarkdownBlock,
  type MarkdownTable,
} from './markdown-blocks.js';
import { renderStructuredPdf } from './pdf-document.js';
import {
  exportChromeCopy,
  labelLifecycleStatus,
  labelRecordType,
} from './export-labels.js';
import {
  mergeHtmlDocxIntoShell,
  type DocxBodyAnchor,
} from './docx-template.js';
import {
  BLANK_STYLE_PACK_ID,
  buildStyleTemplateVars,
  interpolateStyleTemplate,
  type StylePackExportChrome,
} from './style-packs.js';
import { stylePackLogoImgHtml } from './style-pack-logo.js';

export type KnowledgeExportFormat = 'pdf' | 'docx' | 'md' | 'xlsx';

export type KnowledgeExportInput = {
  title: string;
  slug: string;
  summary: string | null;
  recordType: string;
  lifecycleStatus: string;
  contentMarkdown: string;
  exportedAt?: Date;
  /** UI locale (en|de|hu) for cover labels and {type}/{status} tokens. */
  locale?: string | null;
  /** Absolute origin for resolving /api/v1/media/... links (e.g. WEB_URL). */
  webUrl?: string;
  /** Session cookie header so Puppeteer can load private media in PDF. */
  cookieHeader?: string | null;
  /** Resolved Doc Factory style pack; omit or Blank keeps viewer-faithful chrome. */
  stylePack?: StylePackExportChrome | null;
};

function isCustomStylePack(
  pack: StylePackExportChrome | null | undefined,
): pack is StylePackExportChrome {
  return Boolean(pack && pack.id !== BLANK_STYLE_PACK_ID);
}

function exportDisplayLabels(input: KnowledgeExportInput) {
  const locale = input.locale;
  return {
    recordType: labelRecordType(input.recordType, locale),
    lifecycleStatus: labelLifecycleStatus(input.lifecycleStatus, locale),
    exported: exportChromeCopy(locale).exported,
  };
}

function exportMetaLine(input: KnowledgeExportInput): string {
  const labels = exportDisplayLabels(input);
  return `${labels.recordType} · ${labels.lifecycleStatus} · ${input.slug}`;
}

function exportStyleVars(input: KnowledgeExportInput, exportedAt: Date) {
  const labels = exportDisplayLabels(input);
  return buildStyleTemplateVars({
    title: input.title,
    exportedAt,
    slug: input.slug,
    recordType: labels.recordType,
    lifecycleStatus: labels.lifecycleStatus,
  });
}

function mmToTwip(mm: number): number {
  return Math.round((mm / 25.4) * 1440);
}

type HtmlToDocxFn = (
  html: string,
  headerHTML: string | null,
  documentOptions?: Record<string, unknown>,
  footerHTML?: string | null,
) => Promise<Buffer | ArrayBuffer | Uint8Array | Blob>;

function resolveHtmlToDocx(): HtmlToDocxFn {
  let candidate: unknown = htmlToDocxImport;
  // CJS/ESM interop can nest `default` one or two levels under tsx/Node.
  for (let i = 0; i < 3; i += 1) {
    if (typeof candidate === 'function') {
      return candidate as HtmlToDocxFn;
    }
    if (
      candidate &&
      typeof candidate === 'object' &&
      'default' in (candidate as object)
    ) {
      candidate = (candidate as { default: unknown }).default;
      continue;
    }
    break;
  }
  throw new Error('@turbodocx/html-to-docx export is not a function');
}

const HTMLtoDOCX = resolveHtmlToDocx();

function sanitizeFilenamePart(value: string): string {
  return (
    value
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'record'
  );
}

export function knowledgeExportFilename(
  slug: string,
  format: KnowledgeExportFormat,
): string {
  const base = sanitizeFilenamePart(slug);
  if (format === 'md') return `${base}.md`;
  if (format === 'pdf') return `${base}.pdf`;
  if (format === 'xlsx') return `${base}.xlsx`;
  return `${base}.docx`;
}

export function knowledgeExportContentType(format: KnowledgeExportFormat): string {
  if (format === 'md') return 'text/markdown; charset=utf-8';
  if (format === 'pdf') return 'application/pdf';
  if (format === 'xlsx') {
    return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  }
  return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Print stylesheet approximating the hub knowledge-markdown viewer. */
const EXPORT_CSS = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 0;
    font-family: "Segoe UI", "Helvetica Neue", Helvetica, Arial, sans-serif;
    font-size: 11pt;
    line-height: 1.55;
    color: #1a1a1a;
    background: #fff;
  }
  .doc-shell { max-width: 720px; margin: 0 auto; padding: 12px 8px 32px; }
  .doc-meta {
    font-size: 9.5pt;
    color: #555;
    margin: 0 0 8px;
  }
  .doc-summary {
    font-size: 10.5pt;
    color: #333;
    font-style: italic;
    margin: 0 0 16px;
  }
  .doc-rule {
    border: 0;
    border-top: 1px solid #ddd;
    margin: 0 0 20px;
  }
  .knowledge-markdown h1,
  .knowledge-markdown h2,
  .knowledge-markdown h3,
  .knowledge-markdown h4 {
    margin: 1.25em 0 0.4em;
    font-weight: 650;
    letter-spacing: -0.01em;
    line-height: 1.25;
    color: #111;
  }
  .knowledge-markdown h1 { font-size: 1.55rem; }
  .knowledge-markdown h2 { font-size: 1.3rem; }
  .knowledge-markdown h3 { font-size: 1.12rem; }
  .knowledge-markdown h4 { font-size: 1.02rem; }
  .knowledge-markdown p { margin: 0.75em 0; }
  .knowledge-markdown ul,
  .knowledge-markdown ol { margin: 0.75em 0; padding-left: 1.4em; }
  .knowledge-markdown ul { list-style: disc; }
  .knowledge-markdown ol { list-style: decimal; }
  .knowledge-markdown li { margin: 0.25em 0; }
  .knowledge-markdown blockquote {
    margin: 0.9em 0;
    padding: 0.2em 0 0.2em 0.9em;
    border-left: 3px solid #ccc;
    color: #333;
  }
  .knowledge-markdown a { color: #0b5cab; text-decoration: underline; }
  .knowledge-markdown code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.9em;
  }
  .knowledge-markdown :not(pre) > code {
    background: rgba(0,0,0,0.05);
    padding: 0.1em 0.35em;
    border-radius: 4px;
  }
  .knowledge-markdown pre {
    margin: 0.9em 0;
    padding: 12px 14px;
    overflow-x: auto;
    border-radius: 6px;
    background: rgba(0,0,0,0.05);
    font-size: 0.85em;
    line-height: 1.45;
  }
  .knowledge-markdown pre code { background: transparent; padding: 0; }
  .knowledge-markdown pre.mermaid {
    background: transparent;
    text-align: center;
    padding: 8px 0;
  }
  .knowledge-markdown pre.mermaid svg { max-width: 100%; height: auto; }
  /* Fixed layout keeps wide spreadsheet tables inside the printed page box. */
  .knowledge-markdown table {
    width: 100%;
    table-layout: fixed;
    border-collapse: collapse;
    font-size: 0.82em;
    margin: 1em 0;
  }
  .knowledge-markdown th,
  .knowledge-markdown td {
    border: 1px solid #ccc;
    padding: 4px 6px;
    vertical-align: top;
    overflow-wrap: anywhere;
  }
  .knowledge-markdown th {
    background: #f3f3f3;
    font-weight: 650;
  }
  .knowledge-markdown tr:nth-child(even) td { background: rgba(0,0,0,0.02); }
  .knowledge-markdown img {
    max-width: 100%;
    height: auto;
    display: block;
    margin: 0.75em 0;
  }
  .knowledge-markdown hr {
    border: 0;
    border-top: 1px solid #ddd;
    margin: 1.4em 0;
  }
  @page { margin: 16mm 14mm; }
`;

function absolutizeMediaUrls(html: string, webUrl: string): string {
  const base = webUrl.replace(/\/$/, '');
  return html
    .replace(/(src|href)=(["'])(\/api\/v1\/[^"']+)\2/g, (_m, attr, q, path) => {
      return `${attr}=${q}${base}${path}${q}`;
    })
    .replace(/(src|href)=(["'])(\/media\/[^"']+)\2/g, (_m, attr, q, path) => {
      return `${attr}=${q}${base}${path}${q}`;
    });
}

export async function buildExportHtmlDocument(
  input: KnowledgeExportInput,
): Promise<string> {
  const exportedAt = input.exportedAt ?? new Date();
  const rendered = await renderMarkdown(input.contentMarkdown);
  let bodyHtml = rendered.html;
  if (input.webUrl) {
    bodyHtml = absolutizeMediaUrls(bodyHtml, input.webUrl);
  }

  const pack = isCustomStylePack(input.stylePack) ? input.stylePack : null;
  const labels = exportDisplayLabels(input);
  const styleVars = exportStyleVars(input, exportedAt);
  const summary = input.summary?.trim()
    ? `<p class="doc-summary">${escapeHtml(input.summary.trim())}</p>`
    : '';
  const baseHref = input.webUrl
    ? `<base href="${escapeHtml(input.webUrl.replace(/\/$/, ''))}/" />`
    : '';

  const styleOverrides = pack
    ? `
  body { font-family: ${JSON.stringify(pack.typography.bodyFont)}, "Segoe UI", Helvetica, Arial, sans-serif; color: ${pack.typography.bodyColor}; }
  .knowledge-markdown h1, .knowledge-markdown h2, .knowledge-markdown h3, .knowledge-markdown h4 {
    font-family: ${JSON.stringify(pack.typography.headingFont)}, "Segoe UI", Helvetica, Arial, sans-serif;
    color: ${pack.typography.headingColor};
  }
  .doc-meta, .doc-summary { color: ${pack.typography.mutedColor}; }
  .doc-brand { display:flex; align-items:center; gap:10px; margin:0 0 12px; }
  .doc-brand img {
    max-height:48px;
    max-width:180px;
    background: transparent;
    border: 0;
    display: block;
  }
  .doc-disclaimer { font-size:8.5pt; color: ${pack.typography.mutedColor}; font-style: italic; margin: 0 0 12px; }
`
    : '';

  const brand =
    pack && pack.chrome.showCoverBrand && pack.logoDataUri
      ? `<div class="doc-brand">
          ${stylePackLogoImgHtml({
            dataUri: pack.logoDataUri,
            widthPx: pack.logoWidthPx,
            heightPx: pack.logoHeightPx,
            maxWidth: 180,
            maxHeight: 48,
          })}
        </div>`
      : '';
  const showTitle = !pack || pack.chrome.showCoverTitle !== false;
  const showDetails = !pack || pack.chrome.showCoverDetails !== false;
  const titleHtml = showTitle
    ? `<h1 style="margin:0 0 0.35em;font-size:1.7rem;letter-spacing:-0.015em;">${escapeHtml(input.title)}</h1>`
    : '';
  const detailsHtml = showDetails
    ? `<p class="doc-meta">${escapeHtml(labels.recordType)} · ${escapeHtml(labels.lifecycleStatus)} · ${escapeHtml(input.slug)}</p>${summary}<p class="doc-meta">${escapeHtml(labels.exported)} ${escapeHtml(exportedAt.toISOString())}</p>`
    : '';
  const disclaimerRaw = pack?.chrome.disclaimer?.trim()
    ? interpolateStyleTemplate(pack.chrome.disclaimer.trim(), styleVars)
    : '';
  const disclaimer = disclaimerRaw
    ? `<p class="doc-disclaimer">${escapeHtml(disclaimerRaw)}</p>`
    : '';
  const coverRule =
    brand || titleHtml || detailsHtml || disclaimer
      ? `<hr class="doc-rule" />`
      : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  ${baseHref}
  <title>${escapeHtml(input.title)}</title>
  <style>${EXPORT_CSS}${styleOverrides}</style>
</head>
<body>
  <div class="doc-shell">
    ${brand}
    ${titleHtml}
    ${detailsHtml}
    ${disclaimer}
    ${coverRule}
    <article class="knowledge-markdown">
      ${bodyHtml}
    </article>
  </div>
  <script type="module">
    const blocks = document.querySelectorAll('pre.mermaid');
    if (blocks.length > 0) {
      const mermaid = (await import('https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs')).default;
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'neutral' });
      await mermaid.run({ nodes: Array.from(blocks) });
    }
    document.documentElement.dataset.exportReady = '1';
  </script>
</body>
</html>`;
}

export function buildKnowledgeMarkdownExport(input: KnowledgeExportInput): string {
  const exportedAt = (input.exportedAt ?? new Date()).toISOString();
  const summary = input.summary?.trim()
    ? `\nsummary: ${JSON.stringify(input.summary.trim())}`
    : '';
  return (
    `---\n` +
    `title: ${JSON.stringify(input.title)}\n` +
    `slug: ${JSON.stringify(input.slug)}\n` +
    `recordType: ${JSON.stringify(input.recordType)}\n` +
    `lifecycleStatus: ${JSON.stringify(input.lifecycleStatus)}\n` +
    `exportedAt: ${JSON.stringify(exportedAt)}${summary}\n` +
    `---\n\n` +
    `# ${input.title}\n\n` +
    `${input.contentMarkdown.replace(/^\s+/, '')}`
  );
}

let browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    const executablePath =
      process.env.PUPPETEER_EXECUTABLE_PATH ||
      process.env.CHROMIUM_PATH ||
      undefined;
    browserPromise = puppeteer
      .launch({
        headless: true,
        executablePath,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--font-render-hinting=medium',
        ],
      })
      .catch((error) => {
        browserPromise = null;
        throw error;
      });
  }
  return browserPromise;
}

function parseCookieHeader(
  cookieHeader: string,
  webUrl: string,
): Array<{ name: string; value: string; url: string }> {
  const url = webUrl.replace(/\/$/, '');
  return cookieHeader
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const eq = part.indexOf('=');
      if (eq <= 0) return null;
      return {
        name: part.slice(0, eq).trim(),
        value: part.slice(eq + 1).trim(),
        url,
      };
    })
    .filter((c): c is { name: string; value: string; url: string } => Boolean(c));
}

/** Wide spreadsheet-style tables only stay legible on landscape pages. */
function widestTableColumnCount(markdown: string): number {
  return parseMarkdownBlocks(markdown).reduce((widest, block) => {
    if (block.kind !== 'table') return widest;
    const columns = block.table.rows.reduce(
      (max, row) => Math.max(max, row.length),
      block.table.headers.length,
    );
    return Math.max(widest, columns);
  }, 0);
}

async function buildKnowledgeRecordPdfWithPuppeteer(
  input: KnowledgeExportInput,
): Promise<Buffer> {
  const exportedAt = input.exportedAt ?? new Date();
  const html = await buildExportHtmlDocument(input);
  const landscape = widestTableColumnCount(input.contentMarkdown) > 8;
  const pack = isCustomStylePack(input.stylePack) ? input.stylePack : null;
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 900, height: 1200, deviceScaleFactor: 2 });
    if (input.webUrl && input.cookieHeader) {
      const cookies = parseCookieHeader(input.cookieHeader, input.webUrl);
      if (cookies.length > 0) {
        await page.setCookie(...cookies);
      }
    }
    await page.setContent(html, {
      waitUntil: 'load',
      timeout: 60_000,
    });
    await page.waitForFunction(
      'document.documentElement.dataset.exportReady === "1"',
      { timeout: 45_000 },
    );
    await new Promise((resolve) => setTimeout(resolve, 250));

    const hasRunningHeader = Boolean(
      pack &&
        (pack.chrome.headerText?.trim() ||
          (pack.chrome.showLogo &&
            pack.logoDataUri &&
            !pack.chrome.showCoverBrand)),
    );
    const marginTop = pack
      ? `${Math.max(pack.chrome.marginTopMm, hasRunningHeader ? 20 : 0)}mm`
      : '14mm';
    const marginBottom = pack ? `${pack.chrome.marginBottomMm}mm` : '14mm';
    const marginLeft = pack ? `${pack.chrome.marginLeftMm}mm` : '12mm';
    const marginRight = pack ? `${pack.chrome.marginRightMm}mm` : '12mm';
    const footerColor = pack?.typography.mutedColor ?? '#666';
    const styleVars = exportStyleVars(input, exportedAt);
    const footerText = pack
      ? escapeHtml(
          interpolateStyleTemplate(pack.chrome.footerText || '{title}', styleVars),
        ).slice(0, 80)
      : escapeHtml(input.title).slice(0, 80);

    const headerText = pack
      ? escapeHtml(
          interpolateStyleTemplate(pack.chrome.headerText || '', styleVars),
        )
      : '';
    const headerLogo =
      pack?.chrome.showLogo &&
      pack.logoDataUri &&
      // Cover brand already paints the logo on page 1; Chromium cannot omit
      // header chrome on the first page only, so keep text-only headers then.
      !pack.chrome.showCoverBrand
        ? stylePackLogoImgHtml({
            dataUri: pack.logoDataUri,
            widthPx: pack.logoWidthPx,
            heightPx: pack.logoHeightPx,
            maxWidth: 90,
            maxHeight: 22,
            extraStyle: 'margin-right:6px;vertical-align:middle',
          })
        : '';
    const headerTemplate =
      pack && (headerText || headerLogo)
        ? `<div style="font-size:9px;width:100%;box-sizing:border-box;padding:0 ${marginLeft};color:${footerColor};">
            ${headerLogo}<span>${headerText}</span>
          </div>`
        : '<div></div>';

    const pdfOptions: PDFOptions = {
      format: 'A4',
      landscape,
      printBackground: true,
      margin: {
        top: marginTop,
        right: marginRight,
        bottom: marginBottom,
        left: marginLeft,
      },
      displayHeaderFooter: true,
      headerTemplate,
      footerTemplate: `
        <div style="font-size:8px;width:100%;padding:0 ${marginLeft};color:${footerColor};display:flex;justify-content:space-between;">
          <span>${footerText}</span>
          <span><span class="pageNumber"></span>/<span class="totalPages"></span></span>
        </div>
      `,
    };

    // Chrome derives the bookmark tree from the tagged heading structure.
    // Builds that predate the flag reject it, and a flat PDF beats no PDF.
    const pdf = await page
      .pdf({ ...pdfOptions, tagged: true, outline: true })
      .catch(() => page.pdf(pdfOptions));
    return Buffer.from(pdf);
  } finally {
    await page.close();
  }
}

/** Reliable PDF when Chromium/Puppeteer is unavailable (local/dev). */
export function buildKnowledgeRecordPdfWithPdfkit(
  input: KnowledgeExportInput,
): Promise<Buffer> {
  const exportedAt = input.exportedAt ?? new Date();
  const pack = isCustomStylePack(input.stylePack) ? input.stylePack : null;
  const labels = exportDisplayLabels(input);
  const styleVars = exportStyleVars(input, exportedAt);
  return renderStructuredPdf({
    title: input.title,
    metaLine: exportMetaLine(input),
    summary: input.summary,
    footerNote: `${labels.exported} ${exportedAt.toISOString()}`,
    blocks: parseMarkdownBlocks(input.contentMarkdown),
    stylePack: pack
      ? {
          logoDataUri: pack.chrome.showLogo ? pack.logoDataUri : null,
          coverLogoDataUri: pack.chrome.showCoverBrand ? pack.logoDataUri : null,
          showCoverTitle: pack.chrome.showCoverTitle,
          showCoverDetails: pack.chrome.showCoverDetails,
          headerText: interpolateStyleTemplate(
            pack.chrome.headerText || '',
            styleVars,
          ),
          footerText: interpolateStyleTemplate(
            pack.chrome.footerText || '{title}',
            styleVars,
          ),
          disclaimer: pack.chrome.disclaimer?.trim()
            ? interpolateStyleTemplate(pack.chrome.disclaimer.trim(), styleVars)
            : pack.chrome.disclaimer,
          bodyColor: pack.typography.bodyColor,
          mutedColor: pack.typography.mutedColor,
          headingColor: pack.typography.headingColor,
        }
      : undefined,
  });
}

export async function buildKnowledgeRecordPdf(
  input: KnowledgeExportInput,
): Promise<Buffer> {
  try {
    return await buildKnowledgeRecordPdfWithPuppeteer(input);
  } catch {
    // Local hosts often lack Chromium shared libraries; still return a PDF file.
    return buildKnowledgeRecordPdfWithPdfkit(input);
  }
}

/** Rasterizes mermaid sources so Word shows diagrams instead of their source. */
async function renderMermaidImages(
  sources: string[],
  maxWidthPx: number,
): Promise<Array<DocxImage | null>> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1200, height: 900, deviceScaleFactor: 2 });
    const blocks = sources
      .map(
        (source, index) =>
          `<pre class="mermaid" id="mermaid-${index}">${escapeHtml(source)}</pre>`,
      )
      .join('\n');
    await page.setContent(
      `<!DOCTYPE html><html><head><meta charset="utf-8" /><style>
        body { margin: 0; background: #fff; font-family: "Segoe UI", Arial, sans-serif; }
        pre.mermaid { display: inline-block; margin: 0 0 24px; padding: 8px; background: #fff; }
      </style></head><body>${blocks}
      <script type="module">
        const nodes = Array.from(document.querySelectorAll('pre.mermaid'));
        const mermaid = (await import('https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs')).default;
        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'neutral' });
        await mermaid.run({ nodes });
        document.documentElement.dataset.exportReady = '1';
      </script></body></html>`,
      { waitUntil: 'load', timeout: 45_000 },
    );
    await page.waitForFunction('document.documentElement.dataset.exportReady === "1"', {
      timeout: 30_000,
    });

    const images: Array<DocxImage | null> = [];
    for (let index = 0; index < sources.length; index += 1) {
      const element = await page.$(`#mermaid-${index}`);
      const box = await element?.boundingBox();
      if (!element || !box || box.width < 1 || box.height < 1) {
        images.push(null);
        continue;
      }
      const shot = await element.screenshot({ type: 'png', encoding: 'base64' });
      const scale = Math.min(1, maxWidthPx / box.width);
      images.push({
        dataUri: `data:image/png;base64,${shot}`,
        width: box.width * scale,
        height: box.height * scale,
      });
    }
    return images;
  } finally {
    await page.close();
  }
}

async function embedMermaidDiagrams(
  bodyHtml: string,
  maxWidthPx: number,
): Promise<string> {
  const sources: string[] = [];
  replaceMermaidBlocks(bodyHtml, (source) => {
    sources.push(decodeHtmlEntities(source));
    return '';
  });
  if (sources.length === 0) {
    return bodyHtml;
  }

  let images: Array<DocxImage | null> = [];
  try {
    images = await renderMermaidImages(sources, maxWidthPx);
  } catch {
    // No Chromium here; the diagram source stays readable as a code block.
  }

  return replaceMermaidBlocks(bodyHtml, (source, index) => {
    const image = images[index];
    return image ? mermaidImageHtml(image) : mermaidFallbackHtml(source);
  });
}

export async function buildKnowledgeRecordDocx(
  input: KnowledgeExportInput,
): Promise<Buffer> {
  const exportedAt = input.exportedAt ?? new Date();
  const rendered = await renderMarkdown(input.contentMarkdown);
  const landscape = widestTableColumnCount(input.contentMarkdown) > 8;
  const contentWidthPx = landscape ? 900 : 620;
  const pack = isCustomStylePack(input.stylePack) ? input.stylePack : null;
  const styleVars = exportStyleVars(input, exportedAt);

  let bodyHtml = rendered.html;
  if (input.webUrl) {
    bodyHtml = absolutizeMediaUrls(bodyHtml, input.webUrl);
  }
  bodyHtml = await embedMermaidDiagrams(bodyHtml, contentWidthPx);
  bodyHtml = await inlineImageDataUris(bodyHtml, { cookieHeader: input.cookieHeader });

  // Word shell owns letterhead/headers/footers; inject Markdown body only.
  // PDF export ignores docxTemplateBuffer and keeps the HTML/chrome path.
  if (pack?.docxTemplateBuffer) {
    const bodyOnlyHtml = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body>
  ${styleMarkdownHtmlForDocx(bodyHtml)}
</body>
</html>`;
    const bodyResult = await HTMLtoDOCX(
      bodyOnlyHtml,
      null,
      buildDocxDocumentOptions({
        title: input.title,
        landscape,
        bodyFont: pack.typography.bodyFont,
        includeHeader: false,
      }),
      null,
    );
    const bodyDocx = await finalizeDocxPackage(await toBuffer(bodyResult));
    return mergeHtmlDocxIntoShell({
      templateBuffer: pack.docxTemplateBuffer,
      bodyDocxBuffer: bodyDocx,
      vars: styleVars,
      bodyAnchor: pack.docxTemplateBodyAnchor as DocxBodyAnchor | null,
    });
  }

  const html = buildDocxDocumentHtml({
    title: input.title,
    metaLine: exportMetaLine(input),
    summary: input.summary,
    exportedNote: `${exportDisplayLabels(input).exported} ${exportedAt.toISOString()}`,
    bodyHtml,
    style: pack
      ? {
          bodyFont: pack.typography.bodyFont,
          headingFont: pack.typography.headingFont,
          headingColor: pack.typography.headingColor,
          mutedColor: pack.typography.mutedColor,
          bodyColor: pack.typography.bodyColor,
          logoDataUri: pack.logoDataUri,
          showCoverBrand: pack.chrome.showCoverBrand,
          showCoverTitle: pack.chrome.showCoverTitle,
          showCoverDetails: pack.chrome.showCoverDetails,
          disclaimer: pack.chrome.disclaimer?.trim()
            ? interpolateStyleTemplate(pack.chrome.disclaimer.trim(), styleVars)
            : pack.chrome.disclaimer,
          logoWidthPx: pack.logoWidthPx,
          logoHeightPx: pack.logoHeightPx,
        }
      : undefined,
  });

  const headerText = pack
    ? interpolateStyleTemplate(pack.chrome.headerText || '', styleVars)
    : '';
  // Cover brand already paints the logo in the body; keep the running header
  // text-only in that case so page 1 is not blanked and the logo is not doubled.
  const headerLogoUri =
    pack?.chrome.showLogo && !pack.chrome.showCoverBrand
      ? pack.logoDataUri
      : null;
  const headerHtml = pack
    ? buildDocxHeaderHtml({
        text: headerText,
        logoDataUri: headerLogoUri,
        mutedColor: pack.typography.mutedColor,
        logoWidthPx: pack.logoWidthPx,
        logoHeightPx: pack.logoHeightPx,
      })
    : null;

  const footerText = pack
    ? interpolateStyleTemplate(pack.chrome.footerText || '{title}', styleVars)
    : input.title;

  const result = await HTMLtoDOCX(
    html,
    headerHtml,
    buildDocxDocumentOptions({
      title: input.title,
      landscape,
      bodyFont: pack?.typography.bodyFont,
      includeHeader: Boolean(headerHtml),
      margins: pack
        ? {
            top: mmToTwip(pack.chrome.marginTopMm),
            bottom: mmToTwip(pack.chrome.marginBottomMm),
            left: mmToTwip(pack.chrome.marginLeftMm),
            right: mmToTwip(pack.chrome.marginRightMm),
          }
        : undefined,
    }),
    buildDocxFooterHtml(footerText, {
      mutedColor: pack?.typography.mutedColor,
    }),
  );

  return finalizeDocxPackage(await toBuffer(result));
}

async function toBuffer(
  result: Buffer | ArrayBuffer | Uint8Array | Blob,
): Promise<Buffer> {
  if (Buffer.isBuffer(result)) {
    return result;
  }
  if (result instanceof ArrayBuffer || result instanceof Uint8Array) {
    return Buffer.from(result as ArrayBuffer);
  }
  return Buffer.from(await result.arrayBuffer());
}

const DOC_SPAN_COLUMNS = 10;
const DOC_COLUMN_WIDTH = 15;
const DOC_CHARS_PER_LINE = 145;
const HEADING_FONT_SIZES: Record<number, number> = {
  1: 16,
  2: 13,
  3: 12,
  4: 11,
  5: 11,
  6: 11,
};

const TABLE_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FFD4D8DD' } },
  left: { style: 'thin', color: { argb: 'FFD4D8DD' } },
  bottom: { style: 'thin', color: { argb: 'FFD4D8DD' } },
  right: { style: 'thin', color: { argb: 'FFD4D8DD' } },
};

function estimateRowHeight(text: string, charsPerLine = DOC_CHARS_PER_LINE): number {
  const lines = Math.max(1, Math.ceil(text.length / charsPerLine));
  return Math.min(lines * 14 + 3, 320);
}

/** Add a text row that spans the prose width of the sheet. */
function addSpanningRow(
  sheet: ExcelJS.Worksheet,
  text: string,
  style: {
    bold?: boolean;
    italic?: boolean;
    size?: number;
    color?: string;
    monospace?: boolean;
    fill?: string;
    indent?: number;
    wrap?: boolean;
  } = {},
): ExcelJS.Row {
  const row = sheet.addRow([text]);
  sheet.mergeCells(row.number, 1, row.number, DOC_SPAN_COLUMNS);
  const cell = row.getCell(1);
  cell.font = {
    name: style.monospace ? 'Consolas' : 'Calibri',
    size: style.size ?? (style.monospace ? 9 : 11),
    bold: style.bold ?? false,
    italic: style.italic ?? false,
    color: { argb: style.color ?? 'FF1A1A1A' },
  };
  cell.alignment = {
    vertical: 'top',
    wrapText: style.wrap ?? true,
    indent: style.indent ?? 0,
  };
  if (style.fill) {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: style.fill } };
  }
  row.height = style.wrap === false ? 15 : estimateRowHeight(text);
  return row;
}

function addBlankRow(sheet: ExcelJS.Worksheet): void {
  sheet.addRow([]).height = 6;
}

type ColumnWidths = Map<number, number>;

function trackColumnWidth(widths: ColumnWidths, column: number, text: string): void {
  const current = widths.get(column) ?? 0;
  widths.set(column, Math.max(current, text.length));
}

function applyColumnWidths(
  sheet: ExcelJS.Worksheet,
  widths: ColumnWidths,
  fallback: number | null,
): void {
  const maxColumn = Math.max(
    fallback === null ? 0 : DOC_SPAN_COLUMNS,
    ...[0, ...widths.keys()],
  );
  for (let column = 1; column <= maxColumn; column += 1) {
    const measured = widths.get(column);
    sheet.getColumn(column).width =
      measured === undefined
        ? (fallback ?? DOC_COLUMN_WIDTH)
        : Math.min(Math.max(measured + 3, 12), 48);
  }
}

/** Converters emit "Column 7" for spreadsheet grids without real headers. */
const PLACEHOLDER_HEADER_PATTERN = /^column\s*\d+$/i;

function writeDataRow(
  sheet: ExcelJS.Worksheet,
  cells: string[],
  columnCount: number,
  widths: ColumnWidths,
): ExcelJS.Row {
  const row = sheet.addRow([]);
  for (let offset = 0; offset < columnCount; offset += 1) {
    const source = cells[offset] ?? '';
    const coerced = coerceSpreadsheetValue(source);
    const cell = row.getCell(offset + 1);
    cell.value = coerced.value;
    if (coerced.numFmt) {
      cell.numFmt = coerced.numFmt;
    }
    cell.font = { name: 'Calibri', size: 11 };
    cell.alignment =
      typeof coerced.value === 'string'
        ? { vertical: 'top', wrapText: true }
        : { vertical: 'top', horizontal: 'right' };
    cell.border = TABLE_BORDER;
    trackColumnWidth(widths, offset + 1, source);
  }
  return row;
}

/** Write a Markdown table as a real spreadsheet range with typed cells. */
function writeTableRange(
  sheet: ExcelJS.Worksheet,
  table: MarkdownTable,
  widths: ColumnWidths,
): { headerRow: number | null; lastRow: number; columnCount: number } {
  const headers = table.headers.map((header) =>
    PLACEHOLDER_HEADER_PATTERN.test(header) ? '' : header,
  );
  const hasHeader = headers.some((header) => header.length > 0);
  const columnCount = table.rows.reduce(
    (max, row) => Math.max(max, row.length),
    headers.length,
  );

  let headerRowNumber: number | null = null;
  // A header row of placeholders only ("Column 1", …) carries no data, so the
  // grid starts directly with its body rows.
  let lastRow = sheet.rowCount;

  if (hasHeader) {
    const headerRow = sheet.addRow(headers);
    headerRow.height = 18;
    for (let offset = 0; offset < columnCount; offset += 1) {
      const header = headers[offset] ?? '';
      const cell = headerRow.getCell(offset + 1);
      cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF1A1A1A' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF1F4' } };
      cell.alignment = { vertical: 'middle', wrapText: true };
      cell.border = TABLE_BORDER;
      trackColumnWidth(widths, offset + 1, header);
    }
    headerRowNumber = headerRow.number;
    lastRow = headerRow.number;
  }

  for (const row of table.rows) {
    lastRow = writeDataRow(sheet, row, columnCount, widths).number;
  }

  return { headerRow: headerRowNumber, lastRow, columnCount };
}

function uniqueSheetName(workbook: ExcelJS.Workbook, desired: string): string {
  const base = desired.replace(/[\\/*?:[\]]/g, '-').trim().slice(0, 31) || 'Table';
  let candidate = base;
  let suffix = 2;
  while (workbook.getWorksheet(candidate)) {
    const trimmed = base.slice(0, 31 - String(suffix).length - 1);
    candidate = `${trimmed} ${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function writeDocumentSheet(
  sheet: ExcelJS.Worksheet,
  input: KnowledgeExportInput,
  exportedAt: Date,
  blocks: MarkdownBlock[],
): void {
  const widths: ColumnWidths = new Map();

  addSpanningRow(sheet, input.title, { bold: true, size: 18 });
  addSpanningRow(
    sheet,
    exportMetaLine(input),
    { size: 9.5, color: 'FF666666', wrap: false },
  );
  if (input.summary?.trim()) {
    addSpanningRow(sheet, input.summary.trim(), { italic: true, color: 'FF444444' });
  }
  addSpanningRow(
    sheet,
    `${exportDisplayLabels(input).exported} ${exportedAt.toISOString()}`,
    {
      size: 9.5,
      color: 'FF666666',
      wrap: false,
    },
  );
  addBlankRow(sheet);

  for (const block of blocks) {
    switch (block.kind) {
      case 'heading': {
        addBlankRow(sheet);
        addSpanningRow(sheet, block.text, {
          bold: true,
          size: HEADING_FONT_SIZES[block.level] ?? 11,
        });
        break;
      }
      case 'paragraph': {
        addSpanningRow(sheet, block.text);
        break;
      }
      case 'list': {
        for (const item of block.items) {
          addSpanningRow(sheet, `${item.marker} ${item.text}`, {
            indent: 1 + item.depth * 2,
          });
        }
        break;
      }
      case 'quote': {
        addSpanningRow(sheet, block.text, {
          italic: true,
          color: 'FF555555',
          indent: 2,
        });
        break;
      }
      case 'code': {
        const label = block.language === 'mermaid' ? 'Mermaid diagram' : block.language;
        if (label) {
          addSpanningRow(sheet, label, { size: 9, color: 'FF666666', wrap: false });
        }
        for (const line of block.lines) {
          addSpanningRow(sheet, line, {
            monospace: true,
            fill: 'FFF5F6F7',
            wrap: false,
          });
        }
        addBlankRow(sheet);
        break;
      }
      case 'table': {
        addBlankRow(sheet);
        writeTableRange(sheet, block.table, widths);
        addBlankRow(sheet);
        break;
      }
      case 'rule': {
        addBlankRow(sheet);
        break;
      }
    }
  }

  applyColumnWidths(sheet, widths, DOC_COLUMN_WIDTH);
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
}

function writeTableSheet(sheet: ExcelJS.Worksheet, table: MarkdownTable): void {
  const widths: ColumnWidths = new Map();
  const { headerRow, lastRow, columnCount } = writeTableRange(sheet, table, widths);
  applyColumnWidths(sheet, widths, null);
  if (headerRow === null) {
    return;
  }
  sheet.views = [{ state: 'frozen', ySplit: headerRow }];
  if (lastRow > headerRow) {
    sheet.autoFilter = {
      from: { row: headerRow, column: 1 },
      to: { row: lastRow, column: columnCount },
    };
  }
}

export async function buildKnowledgeRecordXlsx(
  input: KnowledgeExportInput,
): Promise<Buffer> {
  const exportedAt = input.exportedAt ?? new Date();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Project Knowledge Hub';
  workbook.created = exportedAt;
  workbook.modified = exportedAt;

  const blocks = parseMarkdownBlocks(input.contentMarkdown);
  writeDocumentSheet(workbook.addWorksheet('Document'), input, exportedAt, blocks);

  const tables = blocks
    .filter((block): block is Extract<MarkdownBlock, { kind: 'table' }> =>
      block.kind === 'table',
    )
    .map((block) => block.table);

  tables.forEach((table, index) => {
    const name = uniqueSheetName(workbook, table.caption ?? `Table ${index + 1}`);
    writeTableSheet(workbook.addWorksheet(name), table);
  });

  const meta = workbook.addWorksheet('Record');
  meta.columns = [
    { header: 'Field', key: 'field', width: 22 },
    { header: 'Value', key: 'value', width: 80 },
  ];
  meta.getRow(1).font = { bold: true };
  meta.addRows([
    { field: 'Title', value: input.title },
    { field: 'Slug', value: input.slug },
    { field: 'Record type', value: exportDisplayLabels(input).recordType },
    { field: 'Lifecycle', value: exportDisplayLabels(input).lifecycleStatus },
    { field: 'Summary', value: input.summary?.trim() || '' },
    { field: 'Exported at', value: exportedAt.toISOString() },
    { field: 'Tables', value: tables.length },
  ]);
  meta.getColumn(2).alignment = { vertical: 'top', wrapText: true };

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
