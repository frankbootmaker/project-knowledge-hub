import { eq } from 'drizzle-orm';
import { hashPassword } from '@project-knowledge-hub/auth';
import { loadEnv } from '@project-knowledge-hub/config';
import { createDatabase, organizations, users } from '@project-knowledge-hub/database';

async function main(): Promise<void> {
  const env = loadEnv();
  const database = createDatabase(env.DATABASE_URL);

  try {
    const [existingOrg] = await database.db
      .select()
      .from(organizations)
      .where(eq(organizations.slug, env.DEFAULT_ORGANIZATION_SLUG))
      .limit(1);

    if (!existingOrg) {
      await database.db.insert(organizations).values({
        name: env.DEFAULT_ORGANIZATION_NAME,
        slug: env.DEFAULT_ORGANIZATION_SLUG,
      });
      console.log(`Seeded organization '${env.DEFAULT_ORGANIZATION_SLUG}'`);
    } else {
      console.log(`Organization '${env.DEFAULT_ORGANIZATION_SLUG}' already exists`);
    }

    if (!env.BOOTSTRAP_ADMIN_EMAIL || !env.BOOTSTRAP_ADMIN_PASSWORD) {
      console.log(
        'BOOTSTRAP_ADMIN_EMAIL/PASSWORD not set; skipping administrator seed',
      );
      return;
    }

    const email = env.BOOTSTRAP_ADMIN_EMAIL.toLowerCase();
    const [existingUser] = await database.db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (existingUser) {
      console.log(`Administrator '${email}' already exists`);
      return;
    }

    const passwordHash = await hashPassword(env.BOOTSTRAP_ADMIN_PASSWORD);
    await database.db.insert(users).values({
      email,
      displayName: env.BOOTSTRAP_ADMIN_DISPLAY_NAME,
      passwordHash,
      status: 'active',
      isSystemAdmin: true,
    });

    console.log(`Seeded bootstrap administrator '${email}'`);
  } finally {
    await database.close();
  }
}

main().catch((error: unknown) => {
  console.error('Seed failed', error);
  process.exit(1);
});
