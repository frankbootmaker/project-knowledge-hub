import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { resolveDatabaseUrl } from '@project-knowledge-hub/config';
import * as schema from './schema/index.js';

export * from './schema/index.js';
export { resolveDatabaseUrl } from '@project-knowledge-hub/config';

export type Database = ReturnType<typeof createDatabase>;

export function createDatabase(connectionString: string) {
  const client = postgres(connectionString, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
  });

  const db = drizzle(client, { schema });

  return {
    db,
    client,
    async ping(): Promise<void> {
      await client`select 1`;
    },
    async close(): Promise<void> {
      await client.end({ timeout: 5 });
    },
  };
}

/** Create a client using POSTGRES_* (encoded) when set, else DATABASE_URL. */
export function createDatabaseFromEnv(
  source: NodeJS.ProcessEnv = process.env,
) {
  return createDatabase(resolveDatabaseUrl(source));
}
