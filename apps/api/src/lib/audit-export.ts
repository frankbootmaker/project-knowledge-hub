export type PublicAuditEvent = {
  id: string;
  organizationId: string | null;
  actorType: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: unknown;
  ipAddress: string | null;
  createdAt: string;
};

const CSV_HEADERS = [
  'id',
  'createdAt',
  'action',
  'entityType',
  'entityId',
  'actorType',
  'actorId',
  'organizationId',
  'ipAddress',
  'metadata',
] as const;

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function cell(value: string | null | undefined): string {
  return csvEscape(value ?? '');
}

export function auditEventsToCsv(events: PublicAuditEvent[]): string {
  const lines = [CSV_HEADERS.join(',')];
  for (const event of events) {
    lines.push(
      [
        cell(event.id),
        cell(event.createdAt),
        cell(event.action),
        cell(event.entityType),
        cell(event.entityId),
        cell(event.actorType),
        cell(event.actorId),
        cell(event.organizationId),
        cell(event.ipAddress),
        cell(event.metadata == null ? '' : JSON.stringify(event.metadata)),
      ].join(','),
    );
  }
  return `${lines.join('\n')}\n`;
}

export function exportFilename(format: 'csv' | 'json', generatedAt = new Date()): string {
  const stamp = generatedAt.toISOString().replace(/[:.]/g, '-');
  return `audit-events-${stamp}.${format}`;
}
