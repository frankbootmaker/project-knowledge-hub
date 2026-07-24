/**
 * After a full-replace pg_restore, the drizzle journal may be missing while
 * app tables exist. Baselining prevents migrate from re-running CREATE TABLE.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { resolveDatabaseUrl } from '@project-knowledge-hub/config';

type JournalEntry = {
  idx: number;
  when: number;
  tag: string;
};

type JournalFile = {
  entries: JournalEntry[];
};

export type BaselineJournalResult =
  | { action: 'ok'; journalRows: number }
  | { action: 'empty-db' }
  | { action: 'baselined'; throughIdx: number; throughTag: string; inserted: number };

/** Newest-first probes: first match wins as the highest applied migration idx. */
const SENTINELS: { idx: number; sql: string }[] = [
  {
    idx: 23,
    sql: `SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'conversation_imports'
        AND column_name = 'content_warnings'
    ) AS ok`,
  },
  {
    idx: 22,
    sql: `SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'users'
        AND column_name = 'signup_pending_escalated_at'
    ) AS ok`,
  },
  {
    idx: 21,
    sql: `SELECT (to_regclass('public.workspace_media') IS NOT NULL) AS ok`,
  },
  {
    idx: 20,
    sql: `SELECT (to_regclass('public.knowledge_record_chunks') IS NOT NULL) AS ok`,
  },
  {
    idx: 19,
    sql: `SELECT (to_regclass('public.conversation_imports') IS NOT NULL) AS ok`,
  },
  {
    idx: 16,
    sql: `SELECT (to_regclass('public.ai_pairing_codes') IS NOT NULL) AS ok`,
  },
  {
    idx: 12,
    sql: `SELECT (to_regclass('public.auth_tokens') IS NOT NULL) AS ok`,
  },
  {
    idx: 9,
    sql: `SELECT (to_regclass('public.git_repository_connections') IS NOT NULL) AS ok`,
  },
  {
    idx: 8,
    sql: `SELECT (to_regclass('public.platform_settings') IS NOT NULL) AS ok`,
  },
  {
    idx: 6,
    sql: `SELECT (to_regclass('public.api_clients') IS NOT NULL) AS ok`,
  },
  {
    idx: 4,
    sql: `SELECT (to_regclass('public.knowledge_record_versions') IS NOT NULL) AS ok`,
  },
  {
    idx: 3,
    sql: `SELECT (to_regclass('public.knowledge_records') IS NOT NULL) AS ok`,
  },
  {
    idx: 1,
    sql: `SELECT (to_regclass('public.sessions') IS NOT NULL) AS ok`,
  },
  {
    idx: 0,
    sql: `SELECT (to_regclass('public.organizations') IS NOT NULL) AS ok`,
  },
];

function migrationsFolderPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.join(here, 'migrations');
}

function readJournal(folder: string): JournalEntry[] {
  const raw = fs.readFileSync(path.join(folder, 'meta/_journal.json'), 'utf8');
  const parsed = JSON.parse(raw) as JournalFile;
  return parsed.entries ?? [];
}

function hashMigrationSql(folder: string, tag: string): string {
  const query = fs.readFileSync(path.join(folder, `${tag}.sql`), 'utf8');
  return crypto.createHash('sha256').update(query).digest('hex');
}

export async function ensureMigrationJournalAfterRestore(
  source: NodeJS.ProcessEnv = process.env,
): Promise<BaselineJournalResult> {
  const databaseUrl = resolveDatabaseUrl(source);
  const folder = migrationsFolderPath();
  const entries = readJournal(folder);
  const client = postgres(databaseUrl, { max: 1 });

  try {
    await client`CREATE SCHEMA IF NOT EXISTS drizzle`;
    await client`
      CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      )
    `;

    const countRows = await client<{ n: string }[]>`
      SELECT COUNT(*)::text AS n FROM drizzle.__drizzle_migrations
    `;
    const journalRows = Number(countRows[0]?.n ?? 0);
    if (journalRows > 0) {
      return { action: 'ok', journalRows };
    }

    const orgRows = await client<{ ok: boolean }[]>`
      SELECT (to_regclass('public.organizations') IS NOT NULL) AS ok
    `;
    if (!orgRows[0]?.ok) {
      return { action: 'empty-db' };
    }

    let throughIdx = 0;
    for (const sentinel of SENTINELS) {
      const rows = await client.unsafe(sentinel.sql) as { ok: boolean }[];
      if (rows[0]?.ok) {
        throughIdx = sentinel.idx;
        break;
      }
    }

    const toInsert = entries.filter((e) => e.idx <= throughIdx);
    if (toInsert.length === 0) {
      return { action: 'empty-db' };
    }

    for (const entry of toInsert) {
      const hash = hashMigrationSql(folder, entry.tag);
      await client`
        INSERT INTO drizzle.__drizzle_migrations ("hash", "created_at")
        VALUES (${hash}, ${entry.when})
      `;
    }

    const last = toInsert[toInsert.length - 1]!;
    return {
      action: 'baselined',
      throughIdx: last.idx,
      throughTag: last.tag,
      inserted: toInsert.length,
    };
  } finally {
    await client.end({ timeout: 5 });
  }
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const result = await ensureMigrationJournalAfterRestore();
  if (result.action === 'ok') {
    console.log(
      `Migration journal OK (${result.journalRows} row(s)); no baseline needed.`,
    );
  } else if (result.action === 'empty-db') {
    console.log('No app schema detected; leaving journal empty for migrate.');
  } else {
    console.log(
      `Baselined drizzle journal through ${result.throughTag} (idx ${result.throughIdx}, ${result.inserted} row(s)).`,
    );
  }
}
