import { describe, expect, it } from 'vitest';
import { auditEventsToCsv, exportFilename } from './audit-export.js';

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
  });
});
