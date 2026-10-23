import { randomUUID } from 'node:crypto';
import { and, isNull, sql } from 'drizzle-orm';
import {
  projectKeyPrefixHistory,
  projects,
  type Database,
} from '@project-knowledge-hub/database';
import { KEY_PREFIX_PATTERN } from '@project-knowledge-hub/domain';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

let sequence = 0;

/** Per-process salt so parallel Vitest workers rarely emit the same prefix. */
const processSalt = Number.parseInt(randomUUID().replace(/-/g, '').slice(0, 6), 16);

function toThreeLetterCode(value: number): string {
  const mod = 26 * 26 * 26;
  const n = ((value % mod) + mod) % mod;
  const a = Math.floor(n / (26 * 26)) % 26;
  const b = Math.floor(n / 26) % 26;
  const c = n % 26;
  return `${LETTERS[a]}${LETTERS[b]}${LETTERS[c]}`;
}

/**
 * Returns a project `keyPrefix` (AAA) that is unique within this process and
 * very unlikely to collide across Vitest workers or repeated integration runs.
 */
export function uniqueIntegrationKeyPrefix(): string {
  sequence += 1;
  const worker = Number.parseInt(process.env.VITEST_WORKER_ID ?? '0', 10) || 0;
  const uuidBits = Number.parseInt(randomUUID().replace(/-/g, '').slice(0, 8), 16);
  const token = sequence + worker * 1_000_003 + uuidBits + processSalt * 17;
  const prefix = toThreeLetterCode(token);
  if (!KEY_PREFIX_PATTERN.test(prefix)) {
    throw new Error(`Generated invalid integration key prefix: ${prefix}`);
  }
  return prefix;
}

/**
 * Picks a `keyPrefix` that is not used by any project in the database yet.
 * Integration suites share one Postgres instance, so human-key resolution needs
 * prefixes to be globally unique, not only unique per workspace.
 */
export async function allocateGlobalIntegrationKeyPrefix(
  database: Database,
): Promise<string> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const candidate = uniqueIntegrationKeyPrefix();
    const [existing] = await database.db
      .select({ id: projects.id })
      .from(projects)
      .where(sql`upper(${projects.keyPrefix}) = ${candidate}`)
      .limit(1);
    const [reserved] = existing
      ? [existing]
      : await database.db
        .select({ id: projectKeyPrefixHistory.id })
        .from(projectKeyPrefixHistory)
        .where(
          and(
            sql`upper(${projectKeyPrefixHistory.keyPrefix}) = ${candidate}`,
            isNull(projectKeyPrefixHistory.releasedAt),
          ),
        )
        .limit(1);
    if (!existing && !reserved) {
      return candidate;
    }
  }
  throw new Error('Could not allocate a globally unused integration key prefix');
}
