/**
 * Removes integration-test organizations, workspaces, and users from the local DB.
 * Keeps the seeded default organization, bootstrap admin, and non-test workspaces.
 */
import { loadEnv } from '@project-knowledge-hub/config';
import {
  createDatabase,
  organizations,
  users,
  workspaces,
} from '@project-knowledge-hub/database';
import { and, eq, like, not, or, sql } from 'drizzle-orm';

async function main(): Promise<void> {
  const env = loadEnv();
  const database = createDatabase(env.DATABASE_URL);
  const keepOrgSlug = env.DEFAULT_ORGANIZATION_SLUG;
  const bootstrapEmail = env.BOOTSTRAP_ADMIN_EMAIL?.toLowerCase();

  try {
    const testOrgs = await database.db
      .select({
        id: organizations.id,
        name: organizations.name,
        slug: organizations.slug,
      })
      .from(organizations)
      .where(
        and(
          not(eq(organizations.slug, keepOrgSlug)),
          or(like(organizations.slug, 'org-%'), like(organizations.name, 'Org %')),
        ),
      );

    console.log(`Keeping organization slug: ${keepOrgSlug}`);
    console.log(`Test organizations to delete: ${testOrgs.length}`);
    for (const org of testOrgs) {
      console.log(`  - ${org.slug}`);
      await database.db.delete(organizations).where(eq(organizations.id, org.id));
    }

    // Auth tests create workspaces inside the default org via the API.
    const testWorkspaces = await database.db
      .select({
        id: workspaces.id,
        name: workspaces.name,
        slug: workspaces.slug,
      })
      .from(workspaces)
      .where(
        or(
          like(workspaces.slug, 'created-%'),
          like(workspaces.slug, 'ws-%'),
          like(workspaces.slug, 'ws-other-%'),
          like(workspaces.slug, 'workspace-%'),
          like(workspaces.name, 'Created %'),
          like(workspaces.name, 'WS %'),
        ),
      );

    console.log(`Test workspaces to delete: ${testWorkspaces.length}`);
    for (const workspace of testWorkspaces) {
      console.log(`  - ${workspace.slug} (${workspace.name})`);
      await database.db.delete(workspaces).where(eq(workspaces.id, workspace.id));
    }

    const testUsers = await database.db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(like(users.email, '%@example.com'));

    let deletedUsers = 0;
    for (const user of testUsers) {
      if (bootstrapEmail && user.email === bootstrapEmail) {
        continue;
      }
      await database.db.delete(users).where(eq(users.id, user.id));
      deletedUsers += 1;
      console.log(`  deleted user ${user.email}`);
    }

    const afterOrgs = await database.db.select().from(organizations);
    const afterWs = await database.db.select().from(workspaces);
    const afterUsers = await database.db
      .select({ email: users.email, isSystemAdmin: users.isSystemAdmin })
      .from(users);
    const [{ count }] = await database.db
      .select({ count: sql<number>`count(*)::int` })
      .from(workspaces);

    console.log(`Deleted ${testOrgs.length} test organization(s).`);
    console.log(`Deleted ${testWorkspaces.length} test workspace(s).`);
    console.log(`Deleted ${deletedUsers} test user(s).`);
    console.log(
      `Remaining: ${afterOrgs.length} org(s), ${count} workspace(s), ${afterUsers.length} user(s).`,
    );
    console.log('Organizations left:');
    for (const org of afterOrgs) {
      console.log(`  - ${org.slug} (${org.name})`);
    }
    console.log('Workspaces left:');
    for (const ws of afterWs) {
      console.log(`  - ${ws.slug} (${ws.name})`);
    }
    console.log('Users left:');
    for (const user of afterUsers) {
      console.log(`  - ${user.email}${user.isSystemAdmin ? ' [admin]' : ''}`);
    }
  } finally {
    await database.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
