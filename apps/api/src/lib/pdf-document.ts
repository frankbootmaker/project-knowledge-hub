import { existsSync } from 'node:fs';
import PDFDocument from 'pdfkit';
import {
  coerceSpreadsheetValue,
  type MarkdownBlock,
  type MarkdownTable,
} from './markdown-blocks.js';

/**
 * Renders parsed Markdown blocks into a laid-out PDF with real headings,
 * lists and tables. Used when Chromium/Puppeteer cannot render the HTML
 * export (for example local hosts without Chrome shared libraries).
 */

export type PdfRenderInput = {
  title: string;
  metaLine: string;
  summary: string | null;
  footerNote: string;
  blocks: MarkdownBlock[];
  stylePack?: {
    logoDataUri?: string | null;
    coverLogoDataUri?: string | null;
    headerText?: string;
    footerText?: string;
    disclaimer?: string;
    bodyColor?: string;
    mutedColor?: string;
    headingColor?: string;
  };
};

type FontSet = {
  body: string;
  bold: string;
  italic: string;
  mono: string;
};

/**
 * PDF core fonts only cover WinAnsi, which drops Latin Extended-A letters
 * such as ő and ű. Prefer any embeddable system font before falling back.
 */
const FONT_CANDIDATES: Record<keyof FontSet, string[]> = {
  body: [
    '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf',
    '/usr/share/fonts/opentype/urw-base35/NimbusSans-Regular.otf',
  ],
  bold: [
    '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    '/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf',
    '/usr/share/fonts/opentype/urw-base35/NimbusSans-Bold.otf',
  ],
  italic: [
    '/usr/share/fonts/truetype/liberation/LiberationSans-Italic.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Oblique.ttf',
    '/usr/share/fonts/truetype/noto/NotoSans-Italic.ttf',
    '/usr/share/fonts/opentype/urw-base35/NimbusSans-Italic.otf',
  ],
  mono: [
    '/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf',
    '/usr/share/fonts/truetype/noto/NotoSansMono-Regular.ttf',
    '/usr/share/fonts/truetype/noto/NotoMono-Regular.ttf',
    '/usr/share/fonts/opentype/urw-base35/NimbusMonoPS-Regular.otf',
  ],
};

const CORE_FONT_FALLBACK: FontSet = {
  body: 'Helvetica',
  bold: 'Helvetica-Bold',
  italic: 'Helvetica-Oblique',
  mono: 'Courier',
};

const A4_SHORT_EDGE = 595.28;
const MARGINS = { top: 52, bottom: 58, left: 48, right: 48 };
const PROSE_MAX_WIDTH = 520;
const HEADING_SIZES: Record<number, number> = {
  1: 16,
  2: 13,
  3: 11.5,
  4: 10.5,
  5: 10,
  6: 10,
};
const BODY_SIZE = 10;
const CODE_SIZE = 8.5;
const TABLE_SIZES = [8.5, 7.5, 6.5, 5.5];
const CELL_PADDING = 3;
const INK = '#1A1A1A';
const INK_MUTED = '#5C6570';
const RULE_COLOR = '#D4D8DD';
const HEADER_FILL = '#EEF1F4';

function registerFonts(doc: PDFKit.PDFDocument): FontSet {
  const fonts = { ...CORE_FONT_FALLBACK };
  for (const key of Object.keys(FONT_CANDIDATES) as Array<keyof FontSet>) {
    const path = FONT_CANDIDATES[key].find((candidate) => existsSync(candidate));
    if (path) {
      doc.registerFont(key, path);
      fonts[key] = key;
    }
  }
  return fonts;
}

type TableCellPlan = {
  text: string;
  numeric: boolean;
};

type TablePlan = {
  columns: number[];
  rows: TableCellPlan[][];
  header: TableCellPlan[] | null;
  fontSize: number;
};

function cellPlan(text: string): TableCellPlan {
  const coerced = coerceSpreadsheetValue(text);
  return { text: text.trim(), numeric: typeof coerced.value === 'number' };
}

/** "Column 7" placeholders come from spreadsheet imports without headers. */
const PLACEHOLDER_HEADER_PATTERN = /^column\s*\d+$/i;

function planTable(
  doc: PDFKit.PDFDocument,
  fonts: FontSet,
  table: MarkdownTable,
  availableWidth: number,
): TablePlan {
  const headerTexts = table.headers.map((header) =>
    PLACEHOLDER_HEADER_PATTERN.test(header) ? '' : header,
  );
  // A header row of placeholders only carries no data, so it is dropped.
  const hasHeader = headerTexts.some((header) => header.length > 0);
  const bodySource = hasHeader ? table.rows : [...table.rows];
  const columnCount = bodySource.reduce(
    (max, row) => Math.max(max, row.length),
    headerTexts.length,
  );

  const header = hasHeader
    ? Array.from({ length: columnCount }, (_, index) => cellPlan(headerTexts[index] ?? ''))
    : null;
  const rows = bodySource.map((row) =>
    Array.from({ length: columnCount }, (_, index) => cellPlan(row[index] ?? '')),
  );

  for (const fontSize of TABLE_SIZES) {
    const natural: number[] = [];
    for (let column = 0; column < columnCount; column += 1) {
      doc.font(fonts.bold).fontSize(fontSize);
      let width = header ? doc.widthOfString(header[column]?.text ?? '') : 0;
      doc.font(fonts.body).fontSize(fontSize);
      for (const row of rows) {
        width = Math.max(width, doc.widthOfString(row[column]?.text ?? ''));
      }
      natural.push(Math.min(width + CELL_PADDING * 2 + 2, 170));
    }

    const total = natural.reduce((sum, width) => sum + width, 0);
    if (total <= availableWidth) {
      return { columns: natural, rows, header, fontSize };
    }

    if (fontSize === TABLE_SIZES[TABLE_SIZES.length - 1]) {
      // Slightly too wide: squeeze roomy columns and let their text wrap.
      if (total <= availableWidth * SQUEEZE_TOLERANCE) {
        return {
          columns: fitColumnWidths(natural, availableWidth),
          rows,
          header,
          fontSize,
        };
      }
      // Far too wide (spreadsheet grids): keep columns legible and let the
      // renderer split them across pages, so numbers never wrap mid-value.
      return {
        columns: natural.map((width) => Math.min(width, availableWidth)),
        rows,
        header,
        fontSize,
      };
    }
  }

  return { columns: [], rows, header, fontSize: TABLE_SIZES[0] ?? BODY_SIZE };
}

const MIN_COLUMN_WIDTH = 16;
const MIN_EMPTY_COLUMN_WIDTH = 9;
const SQUEEZE_TOLERANCE = 1.3;

/**
 * An XYZ bookmark destination. pdfkit subtracts `top` and `left` from the page
 * box, so both are offsets measured from the page's top-left corner.
 */
type OutlineDestination = {
  expanded: boolean;
  fit: boolean;
  zoom: number;
  top: number;
  left: number;
};

/** pdfkit's typings only expose `expanded`, but it accepts a full destination. */
function addOutlineChild(
  parent: PDFKit.PDFOutline,
  title: string,
  destination: OutlineDestination,
): PDFKit.PDFOutline {
  const addItem = parent.addItem as (
    title: string,
    options: OutlineDestination,
  ) => PDFKit.PDFOutline;
  return addItem.call(parent, title, destination);
}

/** Row labels live in the first column, so repeat it on continuation pages. */
function tableHasKeyColumn(plan: TablePlan): boolean {
  if (plan.columns.length <= 6) return false;
  const labelled = plan.rows.filter((row) => row[0]?.text).length;
  return labelled >= Math.ceil(plan.rows.length / 2);
}

/**
 * Group column indices into page-width chunks. `repeatKey` prepends column 0 to
 * every continuation chunk so rows stay identifiable.
 */
export function splitTableColumns(
  columns: number[],
  availableWidth: number,
  repeatKey: boolean,
): number[][] {
  const chunks: number[][] = [];
  let index = 0;

  while (index < columns.length) {
    const chunk: number[] = [];
    let width = 0;

    if (chunks.length > 0 && repeatKey && index > 0) {
      chunk.push(0);
      width += columns[0] ?? 0;
    }

    const minimumColumns = chunk.length + 1;
    while (index < columns.length) {
      const columnWidth = columns[index] ?? 0;
      if (width + columnWidth > availableWidth && chunk.length >= minimumColumns) {
        break;
      }
      chunk.push(index);
      width += columnWidth;
      index += 1;
    }

    chunks.push(chunk);
  }

  return chunks.length > 0 ? chunks : [[]];
}

/** Shrink wide columns toward the page width without starving narrow ones. */
export function fitColumnWidths(natural: number[], availableWidth: number): number[] {
  const floors = natural.map((width) =>
    width <= CELL_PADDING * 2 + 4 ? MIN_EMPTY_COLUMN_WIDTH : MIN_COLUMN_WIDTH,
  );
  const widths = [...natural];

  for (let pass = 0; pass < 8; pass += 1) {
    const total = widths.reduce((sum, width) => sum + width, 0);
    if (total <= availableWidth) break;

    const excess = total - availableWidth;
    const shrinkable = widths.reduce(
      (sum, width, index) => sum + Math.max(width - (floors[index] ?? 0), 0),
      0,
    );
    if (shrinkable <= 0) break;

    const ratio = Math.min(excess / shrinkable, 1);
    for (let index = 0; index < widths.length; index += 1) {
      const floor = floors[index] ?? 0;
      const room = Math.max((widths[index] ?? 0) - floor, 0);
      widths[index] = (widths[index] ?? 0) - room * ratio;
    }
  }

  return widths;
}

export function renderStructuredPdf(input: PdfRenderInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: MARGINS,
      bufferPages: true,
      autoFirstPage: false,
      info: {
        Title: input.title,
        Author: 'Project Knowledge Hub',
        Subject: input.metaLine,
      },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const fonts = registerFonts(doc);

    // One orientation for the whole document: switching per table would leave
    // half-empty pages between sections.
    const portraitContentWidth = A4_SHORT_EDGE - MARGINS.left - MARGINS.right;
    const naturalTableWidths = new Map<MarkdownTable, number>();
    for (const block of input.blocks) {
      if (block.kind === 'table') {
        const probe = planTable(doc, fonts, block.table, Number.MAX_SAFE_INTEGER);
        naturalTableWidths.set(
          block.table,
          probe.columns.reduce((sum, width) => sum + width, 0),
        );
      }
    }
    const layout: 'portrait' | 'landscape' = [...naturalTableWidths.values()].some(
      (width) => width > portraitContentWidth,
    )
      ? 'landscape'
      : 'portrait';

    const addPage = () => {
      doc.addPage({ size: 'A4', layout, margins: MARGINS });
    };

    const contentWidth = () =>
      doc.page.width - doc.page.margins.left - doc.page.margins.right;
    /** Prose stays at a readable measure even on landscape pages. */
    const proseWidth = () => Math.min(contentWidth(), PROSE_MAX_WIDTH);
    const bottomLimit = () => doc.page.height - doc.page.margins.bottom;
    const ensureSpace = (needed: number) => {
      if (doc.y + needed > bottomLimit()) {
        addPage();
      }
    };

    /** Open bookmark ancestors, innermost last. */
    const outlineStack: Array<{ level: number; item: PDFKit.PDFOutline }> = [];

    /** Bookmarks the cursor's current position; call it just before drawing. */
    const bookmarkHeading = (text: string, level: number) => {
      const title = text.trim();
      if (!title) {
        return;
      }
      while ((outlineStack.at(-1)?.level ?? 0) >= level) {
        outlineStack.pop();
      }
      const parent = outlineStack.at(-1)?.item ?? doc.outline;
      const item = addOutlineChild(parent, title, {
        expanded: false,
        fit: false,
        zoom: 0,
        top: Math.max(doc.y - 8, 0),
        left: doc.page.width - doc.page.margins.left,
      });
      outlineStack.push({ level, item });
    };

    const writeText = (
      text: string,
      options: {
        font?: string;
        size?: number;
        color?: string;
        indent?: number;
        gap?: number;
        lineGap?: number;
      } = {},
    ) => {
      const size = options.size ?? BODY_SIZE;
      const indent = options.indent ?? 0;
      doc
        .font(options.font ?? fonts.body)
        .fontSize(size)
        .fillColor(options.color ?? INK);
      ensureSpace(size * 1.4);
      doc.text(text, doc.page.margins.left + indent, doc.y, {
        width: proseWidth() - indent,
        lineGap: options.lineGap ?? 1.5,
        paragraphGap: options.gap ?? 4,
      });
    };

    const drawTable = (table: MarkdownTable) => {
      const available = contentWidth();
      const plan = planTable(doc, fonts, table, available);

      const chunks = splitTableColumns(plan.columns, available, tableHasKeyColumn(plan));

      chunks.forEach((chunk, chunkIndex) => {
        if (chunkIndex > 0) {
          addPage();
          const body = chunk.filter((column) => column !== chunk[0] || chunkIndex === 0);
          const first = (body[0] ?? 0) + 1;
          const last = (body[body.length - 1] ?? 0) + 1;
          writeText(`${table.caption ?? 'Table'} — columns ${first}–${last} (continued)`, {
            font: fonts.italic,
            size: 8.5,
            color: INK_MUTED,
            gap: 4,
          });
        }

        const rowHeight = (cells: TableCellPlan[], font: string): number => {
          doc.font(font).fontSize(plan.fontSize);
          let height = plan.fontSize + CELL_PADDING * 2;
          for (const column of chunk) {
            const cell = cells[column];
            if (!cell?.text) continue;
            height = Math.max(
              height,
              doc.heightOfString(cell.text, {
                width: (plan.columns[column] ?? 0) - CELL_PADDING * 2,
              }) + CELL_PADDING * 2,
            );
          }
          return Math.min(height, 90);
        };

        const drawRow = (
          cells: TableCellPlan[],
          font: string,
          fill: string | null,
        ) => {
          const height = rowHeight(cells, font);
          if (doc.y + height > bottomLimit()) {
            addPage();
          }
          const top = doc.y;
          let x = doc.page.margins.left;

          for (const column of chunk) {
            const width = plan.columns[column] ?? 0;
            const cell = cells[column];
            if (fill) {
              doc.rect(x, top, width, height).fill(fill);
            }
            doc.rect(x, top, width, height).strokeColor(RULE_COLOR).lineWidth(0.5).stroke();
            if (cell?.text) {
              doc
                .font(font)
                .fontSize(plan.fontSize)
                .fillColor(INK)
                .text(cell.text, x + CELL_PADDING, top + CELL_PADDING, {
                  width: width - CELL_PADDING * 2,
                  height: height - CELL_PADDING * 2,
                  align: cell.numeric ? 'right' : 'left',
                  ellipsis: true,
                });
            }
            x += width;
          }

          doc.y = top + height;
        };

        if (plan.header) {
          drawRow(plan.header, fonts.bold, HEADER_FILL);
        }
        for (const row of plan.rows) {
          drawRow(row, fonts.body, null);
        }
      });

      doc.x = doc.page.margins.left;
      doc.moveDown(0.6);
    };

    addPage();

    const inkHeading = input.stylePack?.headingColor ?? INK;
    const muted = input.stylePack?.mutedColor ?? INK_MUTED;

    if (input.stylePack?.coverLogoDataUri) {
      const match = /^data:([^;]+);base64,(.+)$/.exec(
        input.stylePack.coverLogoDataUri,
      );
      if (match?.[2]) {
        try {
          const logo = Buffer.from(match[2], 'base64');
          doc.image(logo, doc.page.margins.left, doc.y, {
            height: 36,
            fit: [160, 36],
          });
          doc.y += 44;
        } catch {
          // Ignore undecodable logos in the pdfkit fallback.
        }
      }
    }
    // Letterhead line under the cover logo (pdfkit has weak running-header support
    // in some viewers; keep the resolved header text visible on page 1).
    if (input.stylePack?.coverLogoDataUri && input.stylePack.headerText?.trim()) {
      writeText(input.stylePack.headerText.trim(), {
        size: 10,
        color: muted,
        gap: 4,
      });
    }

    doc.font(fonts.bold).fontSize(18).fillColor(inkHeading).text(input.title, {
      width: proseWidth(),
      paragraphGap: 4,
    });
    writeText(input.metaLine, { size: 9, color: muted, gap: 1 });
    if (input.summary?.trim()) {
      writeText(input.summary.trim(), { font: fonts.italic, size: 10, color: muted });
    }
    writeText(input.footerNote, { size: 9, color: muted, gap: 4 });
    if (input.stylePack?.disclaimer?.trim()) {
      writeText(input.stylePack.disclaimer.trim(), {
        font: fonts.italic,
        size: 8,
        color: muted,
        gap: 6,
      });
    }
    doc
      .strokeColor(RULE_COLOR)
      .lineWidth(0.75)
      .moveTo(doc.page.margins.left, doc.y)
      .lineTo(doc.page.width - doc.page.margins.right, doc.y)
      .stroke();
    doc.moveDown(0.8);

    for (const block of input.blocks) {
      switch (block.kind) {
        case 'heading': {
          const size = HEADING_SIZES[block.level] ?? BODY_SIZE;
          ensureSpace(size * 3.2);
          doc.moveDown(block.level <= 2 ? 0.5 : 0.3);
          // Settle the cursor on its final page before the bookmark records it.
          ensureSpace(size * 1.4);
          bookmarkHeading(block.text, block.level);
          writeText(block.text, { font: fonts.bold, size, gap: 3 });
          break;
        }
        case 'paragraph': {
          writeText(block.text);
          break;
        }
        case 'list': {
          for (const item of block.items) {
            const indent = 10 + item.depth * 14;
            doc.font(fonts.body).fontSize(BODY_SIZE).fillColor(INK);
            ensureSpace(BODY_SIZE * 1.5);
            const top = doc.y;
            doc.text(item.marker, doc.page.margins.left + indent, top, {
              width: 14,
              lineBreak: false,
            });
            doc.text(item.text, doc.page.margins.left + indent + 14, top, {
              width: proseWidth() - indent - 14,
              paragraphGap: 2,
              lineGap: 1.5,
            });
          }
          doc.moveDown(0.3);
          break;
        }
        case 'quote': {
          const top = doc.y;
          writeText(block.text, {
            font: fonts.italic,
            color: INK_MUTED,
            indent: 14,
            gap: 5,
          });
          doc
            .strokeColor(RULE_COLOR)
            .lineWidth(2)
            .moveTo(doc.page.margins.left + 4, top)
            .lineTo(doc.page.margins.left + 4, doc.y - 5)
            .stroke();
          break;
        }
        case 'code': {
          const label = block.language === 'mermaid' ? 'Mermaid diagram' : block.language;
          if (label) {
            writeText(label, { font: fonts.italic, size: 8, color: INK_MUTED, gap: 2 });
          }
          for (const line of block.lines) {
            writeText(line || ' ', {
              font: fonts.mono,
              size: CODE_SIZE,
              indent: 8,
              gap: 0,
              lineGap: 1,
            });
          }
          doc.moveDown(0.5);
          break;
        }
        case 'table': {
          drawTable(block.table);
          break;
        }
        case 'rule': {
          ensureSpace(12);
          doc
            .strokeColor(RULE_COLOR)
            .lineWidth(0.75)
            .moveTo(doc.page.margins.left, doc.y + 4)
            .lineTo(doc.page.width - doc.page.margins.right, doc.y + 4)
            .stroke();
          doc.y += 12;
          break;
        }
      }
    }

    const range = doc.bufferedPageRange();
    const headerLabel = input.stylePack?.headerText?.trim() || '';
    const footerLabel =
      input.stylePack?.footerText?.trim() || input.title;
    const footerColor = input.stylePack?.mutedColor ?? INK_MUTED;
    for (let index = 0; index < range.count; index += 1) {
      doc.switchToPage(range.start + index);
      const saved = { ...doc.page.margins };
      doc.page.margins = { top: 0, bottom: 0, left: 0, right: 0 };
      if (headerLabel) {
        doc
          .font(fonts.body)
          .fontSize(8)
          .fillColor(footerColor)
          .text(headerLabel, MARGINS.left, 22, {
            width: doc.page.width - MARGINS.left - MARGINS.right,
            lineBreak: false,
          });
      }
      doc
        .font(fonts.body)
        .fontSize(8)
        .fillColor(footerColor)
        .text(
          footerLabel,
          MARGINS.left,
          doc.page.height - MARGINS.bottom + 22,
          { width: doc.page.width - MARGINS.left - MARGINS.right - 60, lineBreak: false },
        )
        .text(
          `${index + 1} / ${range.count}`,
          doc.page.width - MARGINS.right - 60,
          doc.page.height - MARGINS.bottom + 22,
          { width: 60, align: 'right', lineBreak: false },
        );
      doc.page.margins = saved;
    }

    doc.end();
  });
}
