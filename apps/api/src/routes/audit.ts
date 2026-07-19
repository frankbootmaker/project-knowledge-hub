import type { FastifyInstance } from 'fastify';
import {
  and,
  count,
  desc,
  eq,
  gte,
  ilike,
  lt,
  lte,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { z } from 'zod';
import { auditEvents } from '@project-knowledge-hub/database';
import { AppError } from '@project-knowledge-hub/domain';
import { requireSystemAdmin } from '@project-knowledge-hub/permissions';
import {
  auditEventsToCsv,
  exportFilename,
  type PublicAuditEvent,
} from '../lib/audit-export.js';
import { getDefaultOrganization, writeAuditEvent } from '../lib/identity.js';
import { requireAuthenticated } from '../plugins/auth.js';

const EXPORT_MAX_ROWS = 10_000;

const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
  .optional();

const monthSchema = z
  .string()
  .regex(/^\d{4}-\d{2}$/, 'Expected YYYY-MM')
  .optional();

const auditFilterQuerySchema = z.object({
  organizationId: z.string().uuid().optional(),
  action: z.string().max(120).optional(),
  entityType: z.string().max(120).optional(),
  actorType: z.string().max(120).optional(),
  q: z.string().max(200).optional(),
  day: dateOnlySchema,
  from: z.string().max(40).optional(),
  to: z.string().max(40).optional(),
});

function utcDayStart(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

function utcDayEndExclusive(day: string): Date {
  const start = utcDayStart(day);
  return new Date(start.getTime() + 24 * 60 * 60 * 1000);
}

function utcMonthStart(month: string): Date {
  return new Date(`${month}-01T00:00:00.000Z`);
}

function utcMonthEndExclusive(month: string): Date {
  // Date.UTC month is 0-based; numeric month from "YYYY-MM" is 1-based, so this
  // lands on the first day of the following month.
  const [year, monthNumber] = month.split('-').map(Number);
  return new Date(Date.UTC(year!, monthNumber!, 1));
}

function parseBoundary(value: string | undefined, endOfDay: boolean): Date | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return endOfDay ? utcDayEndExclusive(value) : utcDayStart(value);
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function mapAuditEvent(row: typeof auditEvents.$inferSelect): PublicAuditEvent {
  return {
    id: row.id,
    organizationId: row.organizationId,
    actorType: row.actorType,
    actorId: row.actorId,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    metadata: row.metadataJson,
    ipAddress: row.ipAddress,
    createdAt: row.createdAt.toISOString(),
  };
}

function buildFilterConditions(
  input: z.infer<typeof auditFilterQuerySchema>,
): SQL[] {
  const conditions: SQL[] = [];

  if (input.organizationId) {
    conditions.push(eq(auditEvents.organizationId, input.organizationId));
  }
  if (input.action) {
    conditions.push(eq(auditEvents.action, input.action));
  }
  if (input.entityType) {
    conditions.push(eq(auditEvents.entityType, input.entityType));
  }
  if (input.actorType) {
    conditions.push(eq(auditEvents.actorType, input.actorType));
  }

  if (input.q?.trim()) {
    const pattern = `%${input.q.trim()}%`;
    const search = or(
      ilike(auditEvents.action, pattern),
      ilike(auditEvents.entityType, pattern),
      ilike(auditEvents.entityId, pattern),
      ilike(auditEvents.actorType, pattern),
      ilike(auditEvents.actorId, pattern),
      ilike(auditEvents.ipAddress, pattern),
    );
    if (search) {
      conditions.push(search);
    }
  }

  if (input.day) {
    conditions.push(gte(auditEvents.createdAt, utcDayStart(input.day)));
    conditions.push(lt(auditEvents.createdAt, utcDayEndExclusive(input.day)));
  } else {
    const from = parseBoundary(input.from, false);
    const to = parseBoundary(input.to, true);
    if (from) {
      conditions.push(gte(auditEvents.createdAt, from));
    }
    if (to) {
      // date-only `to` is exclusive end-of-next-day; ISO datetimes are inclusive
      if (input.to && /^\d{4}-\d{2}-\d{2}$/.test(input.to)) {
        conditions.push(lt(auditEvents.createdAt, to));
      } else {
        conditions.push(lte(auditEvents.createdAt, to));
      }
    }
  }

  return conditions;
}

function activeFilters(input: z.infer<typeof auditFilterQuerySchema>) {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value != null && value !== ''),
  );
}

export async function registerAuditRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/audit-events/export', async (request, reply) => {
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);
    const query = auditFilterQuerySchema
      .extend({
        format: z.enum(['csv', 'json']).default('csv'),
      })
      .parse(request.query);

    const conditions = buildFilterConditions(query);
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalRow] = await app.database.db
      .select({ total: count() })
      .from(auditEvents)
      .where(whereClause);
    const totalMatching = totalRow?.total ?? 0;

    if (totalMatching > EXPORT_MAX_ROWS) {
      throw new AppError({
        code: 'AUDIT_EXPORT_TOO_LARGE',
        message:
          `Export matches ${totalMatching} events; narrow filters to at most ${EXPORT_MAX_ROWS} before exporting`,
        statusCode: 400,
        details: { totalMatching, maxRows: EXPORT_MAX_ROWS },
      });
    }

    const rows = await app.database.db
      .select()
      .from(auditEvents)
      .where(whereClause)
      .orderBy(desc(auditEvents.createdAt))
      .limit(EXPORT_MAX_ROWS);

    const events = rows.map(mapAuditEvent);
    const generatedAt = new Date();
    const { format, ...filterFields } = query;
    const filters = activeFilters(filterFields);
    const organization = await getDefaultOrganization(app.database);

    await writeAuditEvent(app.database, {
      organizationId: organization?.id ?? null,
      actorType: 'user',
      actorId: principal.userId,
      action: 'audit.export',
      entityType: 'audit_events',
      entityId: null,
      metadata: {
        format,
        exportedCount: events.length,
        totalMatching,
        filters,
      },
      ipAddress: request.ip,
    });

    const filename = exportFilename(format, generatedAt);

    if (format === 'json') {
      return reply
        .header('Content-Type', 'application/json; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .send({
          exportedAt: generatedAt.toISOString(),
          format: 'json',
          totalMatching,
          exportedCount: events.length,
          filters,
          auditEvents: events,
        });
    }

    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .send(auditEventsToCsv(events));
  });

  app.get('/api/v1/audit-events', async (request) => {
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);
    const query = auditFilterQuerySchema
      .extend({
        month: monthSchema,
        page: z.coerce.number().int().min(1).optional(),
        pageSize: z.coerce.number().int().min(1).max(100).optional(),
      })
      .parse(request.query);

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 5;
    const conditions = buildFilterConditions(query);
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalRow] = await app.database.db
      .select({ total: count() })
      .from(auditEvents)
      .where(whereClause);

    const total = totalRow?.total ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(page, totalPages);
    const offset = (safePage - 1) * pageSize;

    const rows = await app.database.db
      .select()
      .from(auditEvents)
      .where(whereClause)
      .orderBy(desc(auditEvents.createdAt))
      .limit(pageSize)
      .offset(offset);

    const [actionRows, entityTypeRows, actorTypeRows] = await Promise.all([
      app.database.db
        .selectDistinct({ value: auditEvents.action })
        .from(auditEvents)
        .orderBy(auditEvents.action)
        .limit(100),
      app.database.db
        .selectDistinct({ value: auditEvents.entityType })
        .from(auditEvents)
        .orderBy(auditEvents.entityType)
        .limit(100),
      app.database.db
        .selectDistinct({ value: auditEvents.actorType })
        .from(auditEvents)
        .orderBy(auditEvents.actorType)
        .limit(50),
    ]);

    let dayCounts: Array<{ day: string; count: number }> = [];
    const month =
      query.month ??
      query.day?.slice(0, 7) ??
      query.from?.slice(0, 7) ??
      new Date().toISOString().slice(0, 7);

    if (monthSchema.safeParse(month).success) {
      const calendarConditions = buildFilterConditions({
        organizationId: query.organizationId,
        action: query.action,
        entityType: query.entityType,
        actorType: query.actorType,
        q: query.q,
      });
      calendarConditions.push(gte(auditEvents.createdAt, utcMonthStart(month)));
      calendarConditions.push(lt(auditEvents.createdAt, utcMonthEndExclusive(month)));

      const countRows = await app.database.db
        .select({
          day: sql<string>`to_char(date_trunc('day', ${auditEvents.createdAt} at time zone 'UTC'), 'YYYY-MM-DD')`,
          count: count(),
        })
        .from(auditEvents)
        .where(and(...calendarConditions))
        .groupBy(sql`date_trunc('day', ${auditEvents.createdAt} at time zone 'UTC')`)
        .orderBy(sql`date_trunc('day', ${auditEvents.createdAt} at time zone 'UTC')`);

      dayCounts = countRows.map((row) => ({
        day: row.day,
        count: row.count,
      }));
    }

    return {
      auditEvents: rows.map(mapAuditEvent),
      pagination: {
        page: safePage,
        pageSize,
        total,
        totalPages,
      },
      facets: {
        actions: actionRows.map((row) => row.value),
        entityTypes: entityTypeRows.map((row) => row.value),
        actorTypes: actorTypeRows.map((row) => row.value),
      },
      calendar: {
        month,
        dayCounts,
      },
      export: {
        maxRows: EXPORT_MAX_ROWS,
        canExport: total <= EXPORT_MAX_ROWS,
      },
    };
  });
}
