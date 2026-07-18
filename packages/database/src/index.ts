import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';

export * from './schema/index.js';

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
