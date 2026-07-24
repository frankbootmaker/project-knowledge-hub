import { count, lt } from 'drizzle-orm';
import { auditEvents, type Database } from '@project-knowledge-hub/database';

/**
 * NF-009 — delete audit_events older than retentionDays.
 */
export async function purgeExpiredAuditEvents(input: {
  database: Database;
  retentionDays: number;
}): Promise<{ deleted: number; cutoff: string | null }> {
  if (input.retentionDays <= 0) {
    return { deleted: 0, cutoff: null };
  }

  const cutoff = new Date(
    Date.now() - input.retentionDays * 24 * 60 * 60 * 1000,
  );
  const where = lt(auditEvents.createdAt, cutoff);

  const [row] = await input.database.db
    .select({ value: count() })
    .from(auditEvents)
    .where(where);
  const deleted = Number(row?.value ?? 0);
  if (deleted === 0) {
    return { deleted: 0, cutoff: cutoff.toISOString() };
  }

  await input.database.db.delete(auditEvents).where(where);
  return { deleted, cutoff: cutoff.toISOString() };
}
