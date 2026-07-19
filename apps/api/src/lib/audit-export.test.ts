import { describe, expect, it } from 'vitest';
import { auditEventsToCsv, exportFilename } from './audit-export.js';
import { buildAuditEventsPdf } from './audit-pdf.js';

describe('auditEventsToCsv', () => {
  it('escapes commas quotes and newlines in CSV cells', () => {
    const csv = auditEventsToCsv([
      {
        id: 'id-1',
        organizationId: null,
        actorType: 'user',
        actorId: 'actor-1',
        action: 'user.create',
        entityType: 'user',
        entityId: 'entity-1',
        metadata: { note: 'hello, "world"\nnext' },
        ipAddress: '127.0.0.1',
        createdAt: '2026-07-19T12:00:00.000Z',
      },
    ]);

    expect(csv.startsWith('id,createdAt,action,')).toBe(true);
    expect(csv).toContain('user.create');
    expect(csv).toContain('""note""');
    expect(csv).toContain('127.0.0.1');
  });
});

describe('exportFilename', () => {
  it('includes format extension', () => {
    expect(exportFilename('csv', new Date('2026-07-19T12:00:00.000Z'))).toMatch(
      /^audit-events-2026-07-19T12-00-00-000Z\.csv$/,
    );
    expect(exportFilename('pdf', new Date('2026-07-19T12:00:00.000Z'))).toMatch(
      /\.pdf$/,
    );
  });
});

describe('buildAuditEventsPdf', () => {
  it('produces a PDF with organization and project in header/footer text', async () => {
    const pdf = await buildAuditEventsPdf(
      [
        {
          id: 'id-1',
          organizationId: 'org-1',
          actorType: 'user',
          actorId: 'actor-1',
          action: 'user.create',
          entityType: 'user',
          entityId: 'entity-1',
          metadata: { note: 'pdf-export' },
          ipAddress: '127.0.0.1',
          createdAt: '2026-07-19T12:00:00.000Z',
        },
      ],
      {
        organizationLabel: 'Acme Org',
        projectLabel: 'Portal (Engineering)',
        filters: { action: 'user.create', day: '2026-07-19' },
        exportedAt: new Date('2026-07-19T16:00:00.000Z'),
        exportedCount: 1,
        totalMatching: 1,
      },
    );

    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const asText = pdf.toString('latin1');
    // Document info is stored as literal PDF strings (parens escaped).
    expect(asText).toContain('Acme Org');
    expect(asText).toMatch(/Portal \\\(Engineering\\\)/);
    expect(asText).toContain('Audit Log Export');
    expect(asText).toMatch(/\/Count 1\b/);
  });
});
