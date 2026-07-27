/**
 * Word-facing presentation layer for knowledge record exports.
 *
 * `@turbodocx/html-to-docx` ignores stylesheets and only reads inline styles,
 * so the viewer's `knowledge-markdown` rules are re-expressed here as
 * per-element declarations.
 */
import JSZip from 'jszip';
import { stylePackLogoImgHtml } from './style-pack-logo.js';

const VIEWER = {
  heading: '#111111',
  muted: '#5A6270',
  headerFill: '#F1F3F5',
  zebraFill: '#FAFBFC',
  codeFill: '#F4F5F7',
  quoteText: '#3A4149',
  link: '#0B5CAB',
  bodyFont: 'Calibri',
  monoFont: 'Consolas',
} as const;

/** highlight.js `github.css` palette, so code reads like the light-theme viewer. */
const HLJS_COLORS: Record<string, string> = {
  doctag: '#D73A49',
  keyword: '#D73A49',
  'template-tag': '#D73A49',
  'template-variable': '#D73A49',
  type: '#D73A49',
  title: '#6F42C1',
  attr: '#005CC5',
  attribute: '#005CC5',
  literal: '#005CC5',
  meta: '#005CC5',
  number: '#005CC5',
  operator: '#005CC5',
  variable: '#005CC5',
  'selector-attr': '#005CC5',
  'selector-class': '#005CC5',
  'selector-id': '#005CC5',
  regexp: '#032F62',
  string: '#032F62',
  built_in: '#E36209',
  symbol: '#E36209',
  comment: '#6A737D',
  code: '#6A737D',
  formula: '#6A737D',
  name: '#22863A',
  quote: '#22863A',
  'selector-tag': '#22863A',
  'selector-pseudo': '#22863A',
  section: '#005CC5',
  bullet: '#735C0F',
  addition: '#22863A',
  deletion: '#B31D28',
};

const HEADING_POINTS: Record<number, number> = { 1: 18, 2: 15, 3: 13, 4: 12, 5: 11, 6: 11 };

const TAG_PATTERN = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
const STYLE_ATTR_PATTERN = /\sstyle="([^"]*)"/;
const ALIGN_ATTR_PATTERN = /\salign="(left|right|center|justify)"/i;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function mergeStyle(attributes: string, declarations: Array<string | null>): string {
  const extra = declarations.filter(Boolean).join(';');
  if (!extra) {
    return attributes;
  }
  const existing = attributes.match(STYLE_ATTR_PATTERN);
  if (!existing) {
    return `${attributes} style="${extra}"`;
  }
  const merged = `${(existing[1] ?? '').replace(/;\s*$/, '')};${extra}`;
  return attributes.replace(STYLE_ATTR_PATTERN, ` style="${merged}"`);
}

function alignDeclaration(attributes: string): string | null {
  const align = attributes.match(ALIGN_ATTR_PATTERN)?.[1];
  return align ? `text-align:${align.toLowerCase()}` : null;
}

function classList(attributes: string): string[] {
  const classes = attributes.match(/\sclass="([^"]*)"/)?.[1];
  return classes ? classes.split(/\s+/).filter(Boolean) : [];
}

function highlightColor(attributes: string): string | null {
  for (const className of classList(attributes)) {
    if (!className.startsWith('hljs-')) {
      continue;
    }
    const color = HLJS_COLORS[className.slice('hljs-'.length)];
    if (color) {
      return color;
    }
  }
  return null;
}

type TableContext = {
  inHeader: boolean;
  bodyRowIndex: number;
  shadeCells: boolean;
  cellFontSize: string;
};

/** Column counts per table, in document order. */
function tableColumnCounts(html: string): number[] {
  return [...html.matchAll(/<table[^>]*>[\s\S]*?<\/table>/g)].map((match) => {
    const firstRow = match[0].match(/<tr[^>]*>[\s\S]*?<\/tr>/)?.[0] ?? '';
    return (firstRow.match(/<t[hd][\s>]/g) ?? []).length;
  });
}

/** Word cannot scroll a table, so wide grids trade point size for legibility. */
function cellFontSize(columns: number): string {
  if (columns > 14) return 'font-size:7pt';
  if (columns > 8) return 'font-size:8pt';
  return 'font-size:9pt';
}

/**
 * Rewrites rendered markdown HTML with the inline styles Word needs:
 * bordered tables with shaded repeating headers, zebra body rows, shaded code
 * blocks with syntax colors, indented quotes and viewer-sized headings.
 */
export function styleMarkdownHtmlForDocx(html: string): string {
  const columnCounts = tableColumnCounts(html);
  const tables: TableContext[] = [];
  let tableIndex = 0;
  let preDepth = 0;
  let quoteDepth = 0;

  return html.replace(
    TAG_PATTERN,
    (match, closing: string, rawName: string, attributes: string, selfClosing: string) => {
      const tag = rawName.toLowerCase();

      if (closing === '/') {
        if (tag === 'pre') preDepth = Math.max(0, preDepth - 1);
        if (tag === 'blockquote') quoteDepth = Math.max(0, quoteDepth - 1);
        if (tag === 'table') tables.pop();
        if (tag === 'thead') {
          const table = tables.at(-1);
          if (table) table.inHeader = false;
        }
        // Word drops paragraph-level styles inside blockquotes, so quote text
        // carries its own run wrapper (opened below).
        if (tag === 'p' && quoteDepth > 0) {
          return `</span>${match}`;
        }
        return match;
      }

      const table = tables.at(-1);
      const declarations: Array<string | null> = [];

      switch (tag) {
        case 'h1':
        case 'h2':
        case 'h3':
        case 'h4':
        case 'h5':
        case 'h6':
          declarations.push(
            `font-size:${HEADING_POINTS[Number(tag.slice(1))]}pt`,
            `color:${VIEWER.heading}`,
            'font-weight:bold',
          );
          break;
        case 'p':
          if (quoteDepth > 0) {
            return `<p${attributes}><span style="color:${VIEWER.quoteText}">`;
          }
          break;
        case 'blockquote':
          quoteDepth += 1;
          break;
        case 'table':
          tables.push({
            inHeader: false,
            bodyRowIndex: 0,
            shadeCells: false,
            cellFontSize: cellFontSize(columnCounts[tableIndex] ?? 0),
          });
          tableIndex += 1;
          declarations.push('border-collapse:collapse', 'width:100%');
          break;
        case 'thead':
          if (table) table.inHeader = true;
          break;
        case 'tr':
          if (table && !table.inHeader) {
            table.bodyRowIndex += 1;
            table.shadeCells = table.bodyRowIndex % 2 === 0;
          }
          break;
        case 'th':
          declarations.push(
            `background-color:${VIEWER.headerFill}`,
            'font-weight:bold',
            table?.cellFontSize ?? null,
            'vertical-align:top',
            alignDeclaration(attributes) ?? 'text-align:left',
          );
          break;
        case 'td':
          declarations.push(
            table?.cellFontSize ?? null,
            'vertical-align:top',
            alignDeclaration(attributes),
            table?.shadeCells ? `background-color:${VIEWER.zebraFill}` : null,
          );
          break;
        case 'pre':
          preDepth += 1;
          declarations.push(
            `background-color:${VIEWER.codeFill}`,
            `font-family:${VIEWER.monoFont}`,
            'font-size:9pt',
          );
          break;
        case 'code':
          declarations.push(`font-family:${VIEWER.monoFont}`);
          if (preDepth === 0) {
            declarations.push(`background-color:${VIEWER.codeFill}`, 'font-size:9.5pt');
          }
          break;
        case 'span': {
          const color = highlightColor(attributes);
          declarations.push(color ? `color:${color}` : null);
          break;
        }
        case 'a':
          declarations.push(`color:${VIEWER.link}`, 'text-decoration:underline');
          break;
        case 'img':
          // Sanitizing drops disallowed sources (e.g. `data:`); html-to-docx
          // throws on a source-less image, so the placeholder is removed.
          if (!/\ssrc="/.test(attributes)) {
            return '';
          }
          break;
        default:
          break;
      }

      const styled = mergeStyle(attributes, declarations);
      return `<${tag}${styled}${selfClosing === '/' ? ' /' : ''}>`;
    },
  );
}

export type DocxDocumentInput = {
  title: string;
  metaLine: string;
  summary: string | null;
  exportedNote: string;
  /** Rendered markdown HTML; styled for Word by this function. */
  bodyHtml: string;
  /** Optional Doc Factory style tokens (Blank = omit). */
  style?: {
    bodyFont?: string;
    headingFont?: string;
    headingColor?: string;
    mutedColor?: string;
    bodyColor?: string;
    logoDataUri?: string | null;
    logoWidthPx?: number | null;
    logoHeightPx?: number | null;
    showCoverBrand?: boolean;
    headerText?: string;
    disclaimer?: string;
  };
};

export function buildDocxDocumentHtml(input: DocxDocumentInput): string {
  const headingColor = input.style?.headingColor ?? VIEWER.heading;
  const mutedColor = input.style?.mutedColor ?? VIEWER.muted;
  const quoteColor = input.style?.bodyColor ?? VIEWER.quoteText;
  const summary = input.summary?.trim()
    ? `<p style="font-size:10.5pt;color:${quoteColor}"><em>${escapeHtml(
        input.summary.trim(),
      )}</em></p>`
    : '';

  const brandHeader = input.style?.headerText?.trim() ?? '';
  const brandLogo =
    input.style?.showCoverBrand && input.style.logoDataUri
      ? stylePackLogoImgHtml({
          dataUri: input.style.logoDataUri,
          widthPx: input.style.logoWidthPx,
          heightPx: input.style.logoHeightPx,
          maxWidth: 180,
          maxHeight: 48,
        })
      : '';
  const brand =
    input.style?.showCoverBrand && (brandLogo || brandHeader)
      ? `<p style="margin:0 0 12pt">
          ${brandLogo}
          ${
            brandHeader
              ? `<span style="font-size:11pt;font-weight:bold;color:${mutedColor};vertical-align:middle;margin-left:8px">${escapeHtml(brandHeader)}</span>`
              : ''
          }
        </p>`
      : '';

  const disclaimer = input.style?.disclaimer?.trim()
    ? `<p style="font-size:8.5pt;color:${mutedColor}"><em>${escapeHtml(
        input.style.disclaimer.trim(),
      )}</em></p>`
    : '';

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body>
  ${brand}
  <h1 style="font-size:20pt;color:${headingColor};font-weight:bold">${escapeHtml(input.title)}</h1>
  <p style="font-size:9.5pt;color:${mutedColor}">${escapeHtml(input.metaLine)}</p>
  ${summary}
  <p style="font-size:9pt;color:${mutedColor}">${escapeHtml(input.exportedNote)}</p>
  ${disclaimer}
  <hr />
  ${styleMarkdownHtmlForDocx(input.bodyHtml)}
</body>
</html>`;
}

export function buildDocxHeaderHtml(input: {
  text: string;
  logoDataUri?: string | null;
  logoWidthPx?: number | null;
  logoHeightPx?: number | null;
  mutedColor?: string;
}): string | null {
  const text = input.text.trim();
  const logo = input.logoDataUri;
  if (!text && !logo) {
    return null;
  }
  const muted = input.mutedColor ?? VIEWER.muted;
  return `<p style="font-size:8pt;color:${muted}">
    ${
      logo
        ? stylePackLogoImgHtml({
            dataUri: logo,
            widthPx: input.logoWidthPx,
            heightPx: input.logoHeightPx,
            maxWidth: 120,
            maxHeight: 28,
            extraStyle: 'vertical-align:middle;margin-right:8px',
          })
        : ''
    }
    ${escapeHtml(text)}
  </p>`;
}

export function buildDocxFooterHtml(
  title: string,
  options?: { mutedColor?: string },
): string {
  const muted = options?.mutedColor ?? VIEWER.muted;
  return `<p style="font-size:8pt;color:${muted}">${escapeHtml(title)}</p>`;
}

/** Word page geometry mirroring the PDF export, in TWIP. */
export function buildDocxDocumentOptions(input: {
  title: string;
  landscape: boolean;
  bodyFont?: string;
  includeHeader?: boolean;
  /**
   * Reserved for callers that need a title-page section; exporters currently
   * keep header/footer on every page and omit the header logo when cover brand
   * already shows it in the body.
   */
  skipFirstHeaderFooter?: boolean;
  /** Margins in TWIP; defaults match Blank export. */
  margins?: {
    top?: number;
    right?: number;
    bottom?: number;
    left?: number;
    footer?: number;
    header?: number;
  };
}): Record<string, unknown> {
  return {
    title: input.title,
    orientation: input.landscape ? 'landscape' : 'portrait',
    pageSize: { width: 11906, height: 16838 },
    margins: {
      top: 1080,
      right: 1000,
      bottom: 1080,
      left: 1000,
      footer: 480,
      ...(input.includeHeader ? { header: 480 } : {}),
      ...input.margins,
    },
    font: input.bodyFont ?? VIEWER.bodyFont,
    fontSize: 22,
    footer: true,
    header: Boolean(input.includeHeader),
    skipFirstHeaderFooter: Boolean(input.skipFirstHeaderFooter),
    pageNumber: true,
    table: {
      row: { cantSplit: true },
      borderOptions: { size: 2, stroke: 'single', color: 'C9CED6' },
    },
    heading: {
      heading1: { fontSize: 36, bold: true, spacing: { before: 320, after: 140 } },
      heading2: { fontSize: 30, bold: true, spacing: { before: 280, after: 120 } },
      heading3: { fontSize: 26, bold: true, spacing: { before: 240, after: 100 } },
      heading4: { fontSize: 24, bold: true, spacing: { before: 220, after: 100 } },
      heading5: { fontSize: 22, bold: true, spacing: { before: 200, after: 80 } },
      heading6: { fontSize: 22, bold: true, spacing: { before: 200, after: 80 } },
    },
    lang: 'en-US',
  };
}

const HEADER_ROW_MARKER = `w:fill="${VIEWER.headerFill.slice(1)}"`;

/**
 * Child sequences of the ECMA-376 property types. Word validates the order of
 * these elements, and html-to-docx emits them in the order the CSS was read.
 */
const PROPERTY_CHILD_ORDER: Record<string, string[]> = {
  pPr: [
    'pStyle', 'keepNext', 'keepLines', 'pageBreakBefore', 'framePr', 'widowControl',
    'numPr', 'suppressLineNumbers', 'pBdr', 'shd', 'tabs', 'suppressAutoHyphens',
    'kinsoku', 'wordWrap', 'overflowPunct', 'topLinePunct', 'autoSpaceDE', 'autoSpaceDN',
    'bidi', 'adjustRightInd', 'snapToGrid', 'spacing', 'ind', 'contextualSpacing',
    'mirrorIndents', 'suppressOverlap', 'jc', 'textDirection', 'textAlignment',
    'textboxTightWrap', 'outlineLvl', 'divId', 'cnfStyle', 'rPr', 'sectPr', 'pPrChange',
  ],
  rPr: [
    'rStyle', 'rFonts', 'b', 'bCs', 'i', 'iCs', 'caps', 'smallCaps', 'strike', 'dstrike',
    'outline', 'shadow', 'emboss', 'imprint', 'noProof', 'snapToGrid', 'vanish',
    'webHidden', 'color', 'spacing', 'w', 'kern', 'position', 'sz', 'szCs', 'highlight',
    'u', 'effect', 'bdr', 'shd', 'fitText', 'vertAlign', 'rtl', 'cs', 'em', 'lang',
    'eastAsianLayout', 'specVanish', 'oMath', 'rPrChange',
  ],
  tblPr: [
    'tblStyle', 'tblpPr', 'tblOverlap', 'bidiVisual', 'tblStyleRowBandSize',
    'tblStyleColBandSize', 'tblW', 'jc', 'tblCellSpacing', 'tblInd', 'tblBorders', 'shd',
    'tblLayout', 'tblCellMar', 'tblLook', 'tblCaption', 'tblDescription', 'tblPrChange',
  ],
  trPr: [
    'cnfStyle', 'divId', 'gridBefore', 'gridAfter', 'wBefore', 'wAfter', 'cantSplit',
    'trHeight', 'tblHeader', 'tblCellSpacing', 'jc', 'hidden', 'ins', 'del', 'trPrChange',
  ],
  tcPr: [
    'cnfStyle', 'tcW', 'gridSpan', 'hMerge', 'vMerge', 'tcBorders', 'shd', 'noWrap',
    'tcMar', 'textDirection', 'tcFitText', 'vAlign', 'hideMark', 'cellIns', 'cellDel',
    'cellMerge', 'tcPrChange',
  ],
  sectPr: [
    'headerReference', 'footerReference', 'footnotePr', 'endnotePr', 'type', 'pgSz',
    'pgMar', 'paperSrc', 'pgBorders', 'lnNumType', 'pgNumType', 'cols', 'formProt',
    'vAlign', 'noEndnote', 'titlePg', 'textDirection', 'bidi', 'rtlGutter', 'docGrid',
    'printerSettings', 'sectPrChange',
  ],
};

/** Splits the children of a property element, keeping each subtree intact. */
function splitChildElements(xml: string): Array<{ name: string; markup: string }> {
  const children: Array<{ name: string; markup: string }> = [];
  const tag = /<w:([\w]+)((?:"[^"]*"|[^>"])*?)(\/?)>/g;
  let match = tag.exec(xml);
  while (match) {
    const [opening, name, , selfClosing] = match;
    if (selfClosing) {
      children.push({ name: name!, markup: opening });
      match = tag.exec(xml);
      continue;
    }
    const closing = `</w:${name}>`;
    const end = xml.indexOf(closing, tag.lastIndex);
    if (end < 0) {
      return [];
    }
    children.push({ name: name!, markup: xml.slice(match.index, end + closing.length) });
    tag.lastIndex = end + closing.length;
    match = tag.exec(xml);
  }
  return children;
}

function orderPropertyChildren(xml: string): string {
  let ordered = xml;
  for (const [property, order] of Object.entries(PROPERTY_CHILD_ORDER)) {
    const pattern = new RegExp(`<w:${property}>([\\s\\S]*?)</w:${property}>`, 'g');
    ordered = ordered.replace(pattern, (match, inner: string) => {
      const children = splitChildElements(inner);
      if (children.length < 2) {
        return match;
      }
      const rank = (name: string) => {
        const index = order.indexOf(name);
        return index < 0 ? order.length : index;
      };
      const sorted = [...children].sort((a, b) => rank(a.name) - rank(b.name));
      return `<w:${property}>${sorted.map((child) => child.markup).join('')}</w:${property}>`;
    });
  }
  return ordered;
}

function markRepeatingHeaderRows(xml: string): string {
  return xml.replace(/<w:tbl>[\s\S]*?<\/w:tbl>/g, (table) => {
    let keptGrid = false;
    const singleGrid = table.replace(/<w:tblGrid>[\s\S]*?<\/w:tblGrid>/g, (grid) => {
      if (keptGrid) {
        return '';
      }
      keptGrid = true;
      return grid;
    });

    const firstRow = singleGrid.match(/<w:tr>[\s\S]*?<\/w:tr>/)?.[0];
    if (!firstRow || !firstRow.includes(HEADER_ROW_MARKER)) {
      return singleGrid;
    }
    const repeating = firstRow.includes('<w:trPr>')
      ? firstRow.replace('<w:trPr>', '<w:trPr><w:tblHeader/>')
      : firstRow.replace('<w:tr>', '<w:tr><w:trPr><w:tblHeader/></w:trPr>');
    return singleGrid.replace(firstRow, repeating);
  });
}

/**
 * Repairs and enriches the OOXML that html-to-docx emits.
 *
 * Three of its outputs make Word reject the file: page width divided by the
 * column count keeps its fraction, a `<w:tblGrid>` is written per row group
 * although a table may only declare one, and property children come out in CSS
 * order rather than the schema sequence. Header rows are also tagged here so
 * long tables repeat their headings on every page, like the viewer's sticky
 * header.
 */
export function normalizeDocumentXml(xml: string): string {
  // Scoped to the `w:` namespace so the XML declaration keeps its 1.0 version.
  const rounded = xml.replace(
    /(\sw:\w+=")(\d+\.\d+)(")/g,
    (_match, prefix: string, value: string, suffix: string) =>
      `${prefix}${Math.round(Number(value))}${suffix}`,
  );

  return orderPropertyChildren(markRepeatingHeaderRows(rounded));
}

const CONTENT_TYPES_PART = '[Content_Types].xml';

/** Rewrites `word/document.xml` inside the generated package. */
export async function finalizeDocxPackage(docx: Buffer): Promise<Buffer> {
  const archive = await JSZip.loadAsync(docx);
  if (!archive.file('word/document.xml')) {
    return docx;
  }

  const parts = Object.values(archive.files)
    .filter((file) => !file.dir)
    .map((file) => file.name);
  // OPC requires the content types stream to lead the package.
  const ordered = [
    CONTENT_TYPES_PART,
    ...parts.filter((name) => name !== CONTENT_TYPES_PART),
  ];

  const output = new JSZip();
  for (const name of ordered) {
    const file = archive.file(name);
    if (!file) {
      continue;
    }
    output.file(
      name,
      name === 'word/document.xml'
        ? normalizeDocumentXml(await file.async('string'))
        : await file.async('nodebuffer'),
    );
  }

  return output.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

const MAX_INLINE_IMAGE_BYTES = 6 * 1024 * 1024;
const IMAGE_FETCH_TIMEOUT_MS = 10_000;

/**
 * Replaces remote `<img>` sources with data URIs.
 *
 * Word documents are built server-side without the caller's session, so
 * private media has to be fetched here with the caller's cookie or it would
 * silently drop out of the document.
 */
export async function inlineImageDataUris(
  html: string,
  options: { cookieHeader?: string | null } = {},
): Promise<string> {
  const sources = new Set<string>();
  for (const match of html.matchAll(/<img[^>]*\ssrc="([^"]+)"/g)) {
    const source = match[1];
    if (source && /^https?:\/\//i.test(source)) {
      sources.add(source);
    }
  }
  if (sources.size === 0) {
    return html;
  }

  const inlined = new Map<string, string>();
  await Promise.all(
    [...sources].map(async (source) => {
      try {
        const response = await fetch(source, {
          headers: options.cookieHeader ? { cookie: options.cookieHeader } : undefined,
          signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS),
        });
        if (!response.ok) {
          return;
        }
        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.byteLength === 0 || buffer.byteLength > MAX_INLINE_IMAGE_BYTES) {
          return;
        }
        const contentType = (response.headers.get('content-type') ?? 'image/png').split(';')[0];
        inlined.set(source, `data:${contentType};base64,${buffer.toString('base64')}`);
      } catch {
        // Leave the URL in place; html-to-docx attempts its own download.
      }
    }),
  );

  if (inlined.size === 0) {
    return html;
  }
  return html.replace(/(<img[^>]*\ssrc=")([^"]+)(")/g, (match, prefix, source, suffix) => {
    const dataUri = inlined.get(source);
    return dataUri ? `${prefix}${dataUri}${suffix}` : match;
  });
}

export type DocxImage = {
  dataUri: string;
  width: number;
  height: number;
};

/** Substitutes rendered diagram images for `<pre class="mermaid">` blocks, in order. */
export function replaceMermaidBlocks(
  html: string,
  render: (source: string, index: number) => string,
): string {
  let index = 0;
  return html.replace(/<pre class="mermaid">([\s\S]*?)<\/pre>/g, (_match, source: string) => {
    const replacement = render(source, index);
    index += 1;
    return replacement;
  });
}

export function mermaidImageHtml(image: DocxImage): string {
  return `<p style="text-align:center"><img src="${image.dataUri}" style="width:${Math.round(
    image.width,
  )}px;height:${Math.round(image.height)}px" alt="Diagram" /></p>`;
}

/** `source` arrives HTML-escaped from the markdown renderer, so it is kept as-is. */
export function mermaidFallbackHtml(source: string): string {
  const text = source.replace(/<\/?[^>]+>/g, '').trim();
  return `<pre style="background-color:${VIEWER.codeFill};font-family:${VIEWER.monoFont};font-size:9pt"><code style="font-family:${VIEWER.monoFont}">${text}</code></pre>`;
}

export function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&');
}
