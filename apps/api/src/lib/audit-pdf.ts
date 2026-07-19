import PDFDocument from 'pdfkit';
import type { PublicAuditEvent } from './audit-export.js';

export type AuditPdfMeta = {
  organizationLabel: string;
  projectLabel: string;
  filters: Record<string, string>;
  exportedAt: Date;
  exportedCount: number;
  totalMatching: number;
};

const MARGIN_LEFT = 48;
const MARGIN_RIGHT = 48;
const MARGIN_TOP = 112;
const MARGIN_BOTTOM = 56;
const HEADER_RULE_Y = 98;
const FOOTER_RULE_OFFSET = 48;

function formatFilters(filters: Record<string, string>): string {
  const entries = Object.entries(filters);
  if (entries.length === 0) {
    return 'None (all matching events)';
  }
  return entries.map(([key, value]) => `${key}=${value}`).join('; ');
}

function formatDisplayTimestamp(date: Date): string {
  return `${date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '')} UTC`;
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

function drawHeaderFooter(
  doc: PDFKit.PDFDocument,
  meta: AuditPdfMeta,
  pageIndex: number,
  pageCount: number,
): void {
  const pageWidth = doc.page.width;
  const pageHeight = doc.page.height;
  const contentWidth = pageWidth - MARGIN_LEFT - MARGIN_RIGHT;
  const stamp = formatDisplayTimestamp(meta.exportedAt);
  const filterLine = truncate(formatFilters(meta.filters), 140);
  const savedMargins = { ...doc.page.margins };

  // PDFKit can add blank pages when painting outside the content box; clear
  // margins while drawing repeating chrome.
  doc.page.margins = { top: 0, bottom: 0, left: 0, right: 0 };
  doc.save();
  doc.fillColor('#111111').strokeColor('#999999');

  try {
    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .text('Project Knowledge Hub — Audit Log Export', MARGIN_LEFT, 28, {
        width: contentWidth,
        lineBreak: false,
      });

    doc.font('Helvetica').fontSize(7.5);
    doc.text(`Organization: ${meta.organizationLabel}`, MARGIN_LEFT, 44, {
      width: contentWidth,
      lineBreak: false,
    });
    doc.text(`Project: ${meta.projectLabel}`, MARGIN_LEFT, 55, {
      width: contentWidth,
      lineBreak: false,
    });
    doc.text(`Date / timestamp: ${stamp}`, MARGIN_LEFT, 66, {
      width: contentWidth,
      lineBreak: false,
    });
    doc.text(
      `Audit details: ${filterLine} · ${meta.exportedCount} event(s)`,
      MARGIN_LEFT,
      77,
      { width: contentWidth, lineBreak: false },
    );

    doc
      .moveTo(MARGIN_LEFT, HEADER_RULE_Y)
      .lineTo(pageWidth - MARGIN_RIGHT, HEADER_RULE_Y)
      .lineWidth(0.5)
      .stroke();

    const footerY = pageHeight - 36;
    doc
      .moveTo(MARGIN_LEFT, pageHeight - FOOTER_RULE_OFFSET)
      .lineTo(pageWidth - MARGIN_RIGHT, pageHeight - FOOTER_RULE_OFFSET)
      .lineWidth(0.5)
      .stroke();

    doc.fontSize(7).fillColor('#333333');
    doc.text(
      truncate(
        `Confidential · Org: ${meta.organizationLabel} · Project: ${meta.projectLabel} · ${meta.exportedAt.toISOString()}`,
        110,
      ),
      MARGIN_LEFT,
      footerY,
      {
        width: contentWidth - 72,
        lineBreak: false,
      },
    );
    doc.text(`Page ${pageIndex + 1} of ${pageCount}`, pageWidth - MARGIN_RIGHT - 72, footerY, {
      width: 72,
      align: 'right',
      lineBreak: false,
    });
  } finally {
    doc.restore();
    doc.page.margins = savedMargins;
  }
}

function writeEventBlock(doc: PDFKit.PDFDocument, event: PublicAuditEvent): void {
  const when = formatDisplayTimestamp(new Date(event.createdAt));
  const metadata =
    event.metadata == null ? '' : truncate(JSON.stringify(event.metadata), 280);

  doc.font('Helvetica-Bold').fontSize(8).fillColor('#111111').text(when);
  doc.font('Helvetica').fontSize(8);
  doc.text(
    `Action: ${event.action}  ·  Entity: ${event.entityType}${event.entityId ? ` / ${event.entityId}` : ''}`,
  );
  doc.text(
    `Actor: ${event.actorType}${event.actorId ? ` / ${event.actorId}` : ''}  ·  Org: ${event.organizationId ?? '—'}  ·  IP: ${event.ipAddress ?? '—'}`,
  );
  if (metadata) {
    doc.fillColor('#444444').text(`Metadata: ${metadata}`);
  }
  doc.fillColor('#111111').moveDown(0.55);
}

export function buildAuditEventsPdf(
  events: PublicAuditEvent[],
  meta: AuditPdfMeta,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      bufferPages: true,
      margins: {
        top: MARGIN_TOP,
        bottom: MARGIN_BOTTOM,
        left: MARGIN_LEFT,
        right: MARGIN_RIGHT,
      },
      info: {
        Title: 'Audit Log Export',
        Author: 'Project Knowledge Hub',
        Subject: `Organization: ${meta.organizationLabel}; Project: ${meta.projectLabel}`,
        CreationDate: meta.exportedAt,
      },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    doc.on('end', () => {
      resolve(Buffer.concat(chunks));
    });
    doc.on('error', reject);

    doc.font('Helvetica-Bold').fontSize(12).text('Audit log export');
    doc.moveDown(0.35);
    doc.font('Helvetica').fontSize(9);
    doc.text(`Organization: ${meta.organizationLabel}`);
    doc.text(`Project: ${meta.projectLabel}`);
    doc.text(`Exported at: ${formatDisplayTimestamp(meta.exportedAt)}`);
    doc.text(
      `Events in this file: ${meta.exportedCount} (matched ${meta.totalMatching})`,
    );
    doc.text(`Filters: ${formatFilters(meta.filters)}`);
    doc.moveDown(0.75);

    if (events.length === 0) {
      doc.font('Helvetica-Oblique').text('No audit events matched the selected filters.');
    } else {
      for (const event of events) {
        writeEventBlock(doc, event);
      }
    }

    const range = doc.bufferedPageRange();
    for (let index = 0; index < range.count; index += 1) {
      doc.switchToPage(range.start + index);
      drawHeaderFooter(doc, meta, index, range.count);
    }

    doc.end();
  });
}
