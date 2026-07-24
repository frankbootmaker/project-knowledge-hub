import { eq } from 'drizzle-orm';
import { hashPassword } from '@project-knowledge-hub/auth';
import { createDatabase, organizations, users } from '@project-knowledge-hub/database';

/**
 * Dokploy one-shot: create default org + optional bootstrap admin.
 * Intentionally does NOT call full `loadEnv()` — migrate/seed must not fail
 * redeploys because of unrelated empty optional env vars (SMTP_*, etc.).
 */
function readBootstrapConfig(): {
  databaseUrl: string;
  organizationName: string;
  organizationSlug: string;
  adminEmail: string | undefined;
  adminPassword: string | undefined;
  adminDisplayName: string;
} {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required to run seed');
  }

  const organizationName =
    process.env.DEFAULT_ORGANIZATION_NAME?.trim() || 'Default Organization';
  const organizationSlug =
    process.env.DEFAULT_ORGANIZATION_SLUG?.trim() || 'default';
  const adminDisplayName =
    process.env.BOOTSTRAP_ADMIN_DISPLAY_NAME?.trim() || 'Administrator';

  let adminEmail = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim() || undefined;
  let adminPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD?.trim() || undefined;

  if (adminEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) {
    console.warn(
      `BOOTSTRAP_ADMIN_EMAIL '${adminEmail}' is not a valid email; skipping administrator seed`,
    );
    adminEmail = undefined;
    adminPassword = undefined;
  }

  if (adminPassword && adminPassword.length < 12) {
    console.warn(
      'BOOTSTRAP_ADMIN_PASSWORD must be at least 12 characters; skipping administrator seed',
    );
    adminEmail = undefined;
    adminPassword = undefined;
  }

  if (adminEmail && !adminPassword) {
    console.warn(
      'BOOTSTRAP_ADMIN_EMAIL set without BOOTSTRAP_ADMIN_PASSWORD; skipping administrator seed',
    );
    adminEmail = undefined;
  }

  if (adminPassword && !adminEmail) {
    console.warn(
      'BOOTSTRAP_ADMIN_PASSWORD set without BOOTSTRAP_ADMIN_EMAIL; skipping administrator seed',
    );
    adminPassword = undefined;
  }

  return {
    databaseUrl,
    organizationName,
    organizationSlug,
    adminEmail,
    adminPassword,
    adminDisplayName,
  };
}

async function main(): Promise<void> {
  const config = readBootstrapConfig();
  const database = createDatabase(config.databaseUrl);

  try {
    const [existingOrg] = await database.db
      .select()
      .from(organizations)
      .where(eq(organizations.slug, config.organizationSlug))
      .limit(1);

    if (!existingOrg) {
      await database.db.insert(organizations).values({
        name: config.organizationName,
        slug: config.organizationSlug,
      });
      console.log(`Seeded organization '${config.organizationSlug}'`);
    } else {
      console.log(`Organization '${config.organizationSlug}' already exists`);
    }

    if (!config.adminEmail || !config.adminPassword) {
      console.log(
        'BOOTSTRAP_ADMIN_EMAIL/PASSWORD not set (or invalid); skipping administrator seed',
      );
      return;
    }

    const email = config.adminEmail.toLowerCase();
    const [existingUser] = await database.db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (existingUser) {
      console.log(`Administrator '${email}' already exists`);
      return;
    }

    const passwordHash = await hashPassword(config.adminPassword);
    await database.db.insert(users).values({
      email,
      displayName: config.adminDisplayName,
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
