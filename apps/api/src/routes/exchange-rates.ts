import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  ensureExchangeRates,
  listExchangeRates,
  saveManualExchangeRate,
} from '@project-knowledge-hub/database';
import { requireSystemAdmin } from '@project-knowledge-hub/permissions';
import { assertMutatingOrigin, requireAuthenticated } from '../plugins/auth.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function shiftIso(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export async function registerExchangeRateRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/admin/exchange-rates', async (request) => {
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);
    const query = z
      .object({
        from: isoDate.optional(),
        to: isoDate.optional(),
      })
      .parse(request.query);
    const to = query.to ?? todayIso();
    const from = query.from ?? shiftIso(to, -30);
    return {
      from,
      to,
      rates: await listExchangeRates(app.database, from, to),
    };
  });

  app.put('/api/v1/admin/exchange-rates', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);
    const body = z
      .object({
        date: isoDate,
        base: z.string().min(3).max(3),
        quote: z.string().min(3).max(3),
        rate: z.number().positive(),
      })
      .parse(request.body);
    const rate = await saveManualExchangeRate(app.database, body);
    return { rate };
  });

  app.post('/api/v1/admin/exchange-rates/import', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);
    const body = z
      .object({
        from: isoDate.optional(),
        to: isoDate.optional(),
      })
      .parse(request.body ?? {});
    const to = body.to ?? todayIso();
    const from = body.from ?? shiftIso(to, -10);
    const result = await ensureExchangeRates(
      app.database,
      [from, to],
      globalThis.fetch,
    );
    return {
      from,
      to,
      imported: result.imported,
      error: result.error ?? null,
      rates: await listExchangeRates(app.database, from, to),
    };
  });
}
