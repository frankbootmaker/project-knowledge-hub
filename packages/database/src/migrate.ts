import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import {
  loadNearestDotEnv,
  resolveDatabaseUrl,
} from '@project-knowledge-hub/config';
import { resolveMigrationsFolder } from './migrations-path.js';

loadNearestDotEnv();

function operatorHint(error: unknown): string {
  const text =
    error instanceof Error
      ? `${error.message}\n${error.stack ?? ''}`
      : String(error);
  if (
    /28P01|password authentication failed|invalid password/i.test(text)
  ) {
    return (
      'HINT: Postgres rejected the password (28P01). POSTGRES_PASSWORD in Dokploy ' +
      'must match the role password stored in the volume (set at first init). ' +
      'Fix with ALTER USER … PASSWORD … or wipe the Postgres volume; avoid $ in passwords.'
    );
  }
  if (
    /already exists|duplicate key|multiple primary keys|42710|42P07/i.test(
      text,
    )
  ) {
    return (
      'HINT: Schema objects already exist but the drizzle migration journal is missing ' +
      'or behind (common after a partial import). Re-import a full dump, or wipe the ' +
      'Postgres volume and redeploy. Do not treat wipe as the routine fix.'
    );
  }
  return 'HINT: See migrate error above; check migrate container logs on Dokploy.';
}

const databaseUrl = resolveDatabaseUrl();
const migrationsFolder = resolveMigrationsFolder();

const client = postgres(databaseUrl, { max: 1 });
const db = drizzle(client);

try {
  await migrate(db, { migrationsFolder });
  await client.end({ timeout: 5 });
  console.log('Migrations applied successfully');
} catch (error) {
  console.error('Migration failed:', error);
  console.error(operatorHint(error));
  try {
    await client.end({ timeout: 5 });
  } catch {
    // ignore close errors after failure
  }
  process.exit(1);
}
