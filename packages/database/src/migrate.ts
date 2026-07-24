import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveDatabaseUrl } from '@project-knowledge-hub/config';

const databaseUrl = resolveDatabaseUrl();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.join(__dirname, 'migrations');

const client = postgres(databaseUrl, { max: 1 });
const db = drizzle(client);

await migrate(db, { migrationsFolder });
await client.end({ timeout: 5 });

console.log('Migrations applied successfully');
