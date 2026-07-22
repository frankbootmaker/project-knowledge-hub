/**
 * Dev-only: purge integration-test clutter and seed a realistic Home Infrastructure demo.
 *
 * Keeps: organization `default`, workspace `home-infrastructure`, admin@localhost.local
 * Removes: *@example.com users and non-default organizations (cascades their workspaces).
 *
 * Usage: pnpm --filter @project-knowledge-hub/database seed:demo
 */
import { and, eq, ne, like, sql } from 'drizzle-orm';
import { loadEnv } from '@project-knowledge-hub/config';
import {
  createDatabase,
  apiClients,
  conversationImports,
  gitRepositoryConnections,
  knowledgeRecords,
  knowledgeRecordVersions,
  memberships,
  organizations,
  projects,
  systems,
  users,
  workspaces,
} from '@project-knowledge-hub/database';

const DEMO_WORKSPACE_SLUG = 'home-infrastructure';

async function main(): Promise<void> {
  const env = loadEnv();
  if (env.APP_ENV !== 'development' && env.APP_ENV !== 'test' && env.NODE_ENV !== 'development') {
    throw new Error('seed:demo is only allowed in development/test');
  }

  const database = createDatabase(env.DATABASE_URL);

  try {
    console.log('Cleaning integration-test organizations (keep default)…');
    // Drop all API clients first (test tokens); users can recreate via wizard
    await database.db.delete(apiClients);
    const deletedOrgs = await database.db
      .delete(organizations)
      .where(ne(organizations.slug, env.DEFAULT_ORGANIZATION_SLUG))
      .returning({ slug: organizations.slug });
    console.log(`  deleted ${deletedOrgs.length} orgs`);

    // Any leftover workspaces not under default (shouldn't remain)
    const leftoverWs = await database.db
      .delete(workspaces)
      .where(ne(workspaces.slug, DEMO_WORKSPACE_SLUG))
      .returning({ slug: workspaces.slug });
    if (leftoverWs.length > 0) {
      console.log(`  deleted ${leftoverWs.length} leftover workspaces`);
    }

    console.log('Removing *@example.com test users…');
    // Clear version/record authorship that might still reference them in default workspace
    const testUsers = await database.db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(like(users.email, '%@example.com'));

    for (const user of testUsers) {
      await database.db
        .delete(knowledgeRecordVersions)
        .where(eq(knowledgeRecordVersions.createdBy, user.id));
      await database.db
        .delete(knowledgeRecords)
        .where(eq(knowledgeRecords.createdBy, user.id));
      await database.db
        .delete(gitRepositoryConnections)
        .where(eq(gitRepositoryConnections.createdBy, user.id));
      await database.db
        .delete(conversationImports)
        .where(eq(conversationImports.createdBy, user.id));
      await database.db.delete(users).where(eq(users.id, user.id));
    }
    console.log(`  deleted ${testUsers.length} users`);

    // Drop demo records so re-seed is idempotent
    const [workspace] = await database.db
      .select()
      .from(workspaces)
      .where(eq(workspaces.slug, DEMO_WORKSPACE_SLUG))
      .limit(1);

    if (!workspace) {
      throw new Error(`Workspace '${DEMO_WORKSPACE_SLUG}' not found — create it in the UI first`);
    }

    const [admin] = await database.db
      .select()
      .from(users)
      .where(eq(users.email, (env.BOOTSTRAP_ADMIN_EMAIL ?? 'admin@localhost.local').toLowerCase()))
      .limit(1);
    if (!admin) {
      throw new Error('Bootstrap admin not found');
    }

    await database.db
      .delete(knowledgeRecords)
      .where(eq(knowledgeRecords.workspaceId, workspace.id));
    await database.db.delete(systems).where(eq(systems.workspaceId, workspace.id));
    await database.db.delete(projects).where(eq(projects.workspaceId, workspace.id));

    // Ensure admin membership
    const [membership] = await database.db
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, admin.id),
          eq(memberships.workspaceId, workspace.id),
        ),
      )
      .limit(1);
    if (!membership) {
      await database.db.insert(memberships).values({
        userId: admin.id,
        workspaceId: workspace.id,
        role: 'workspace_admin',
      });
    }

    console.log('Seeding demo projects / systems / knowledge…');

    const [labProject] = await database.db
      .insert(projects)
      .values({
        workspaceId: workspace.id,
        name: 'Homelab Platform',
        slug: 'homelab-platform',
        status: 'active',
        summary: 'Core home lab: networking, compute, and knowledge tooling.',
        description:
          'Owns the always-on services that back daily work: Proxmox hosts, Traefik edge, and Project Knowledge Hub itself.',
        ownerUserId: admin.id,
      })
      .returning();

    const [aiProject] = await database.db
      .insert(projects)
      .values({
        workspaceId: workspace.id,
        name: 'AI Assistants',
        slug: 'ai-assistants',
        status: 'active',
        summary: 'LLM clients connected to the hub (Cursor, ChatGPT, OpenWebUI).',
        description:
          'Tracks how assistants read and write draft knowledge via MCP / OpenAPI Actions.',
        ownerUserId: admin.id,
      })
      .returning();

    if (!labProject || !aiProject) {
      throw new Error('Failed to create demo projects');
    }

    const [proxmox] = await database.db
      .insert(systems)
      .values({
        workspaceId: workspace.id,
        projectId: labProject.id,
        name: 'Proxmox Cluster',
        slug: 'proxmox-cluster',
        status: 'active',
        summary: 'Two-node Proxmox VE for VMs and LXC.',
        ownerUserId: admin.id,
      })
      .returning();

    const [knowhub] = await database.db
      .insert(systems)
      .values({
        workspaceId: workspace.id,
        projectId: labProject.id,
        name: 'Project Knowledge Hub',
        slug: 'project-knowledge-hub',
        status: 'active',
        summary: 'This application — API, web, worker, Postgres, Redis.',
        ownerUserId: admin.id,
      })
      .returning();

    const [openwebui] = await database.db
      .insert(systems)
      .values({
        workspaceId: workspace.id,
        projectId: aiProject.id,
        name: 'OpenWebUI',
        slug: 'openwebui',
        status: 'active',
        summary: 'Local chat UI with MCP tool servers.',
        ownerUserId: admin.id,
      })
      .returning();

    if (!proxmox || !knowhub || !openwebui) {
      throw new Error('Failed to create demo systems');
    }

    const architectureMd = `# Homelab platform overview

## Purpose

Document how the home lab is structured so assistants and humans can find the same source of truth in Project Knowledge Hub.

## Network edge

Traffic enters through a reverse proxy on the LAN. Public HTTPS (when used for ChatGPT / Claude remote MCP) terminates on the published host, not on Docker-internal names such as \`api:3101\`.

### DNS and TLS

- Internal names resolve on the LAN DNS.
- Certificates are renewed automatically; check the proxy dashboard after network changes.

### Split DNS caveat

LLM cloud clients cannot reach \`localhost\`. Prefer \`WEB_URL\` / \`MCP_PUBLIC_URL\` for Actions and MCP.

## Compute

### Proxmox

VMs and LXC containers host Postgres, Redis, and app stacks. Snapshot before major upgrades.

### Storage

Keep database volumes on mirrored storage. Backup restore is documented under operations runbooks.

## Knowledge Hub stack

| Service | Role |
| --- | --- |
| web | Next.js UI + reverse rewrite to API / MCP |
| api | Fastify REST, MCP \`/mcp\`, OpenAPI \`/api/v1/llm\` |
| worker | Git sync and embedding jobs |
| postgres | Primary store (\`pgvector\` when hybrid search is enabled) |
| redis | Sessions / queues |

## Related systems

See linked systems on the **Homelab Platform** project page: Proxmox Cluster and Project Knowledge Hub.

## Open questions

1. When should Dokploy UAT promote to production?
2. Should embeddings stay disabled until a GPU host is dedicated?
`;

    const runbookMd = `# Knowledge Hub operator runbook

## Health checks

1. Open \`/status\` as a system administrator.
2. Confirm API health and readiness.
3. From Account → AI connections, run wizard preflight (public MCP URL).

## User MCP setup

Members create their own API clients:

1. Account → **AI connections**
2. Choose client (Cursor / ChatGPT / …), workspace, read or write
3. Copy the one-time token and schema
4. Finish setup

### ChatGPT Custom GPT

Use the dedicated Custom GPT with Actions — do not rely on \`@\` mentions in a normal chat.

## Incident: MCP initialize EOF

If clients close the connection on \`initialize\`:

1. Confirm web middleware allows \`/mcp\` through to the API (not login HTML).
2. Confirm \`/.well-known/*\` returns JSON 404, not HTML.
3. Probe with a Bearer token against the public MCP URL.

## Rollback

Restore Postgres from the latest backup volume; redeploy previous Compose image tags.
`;

    const chatgptNotesMd = `# ChatGPT Custom GPT notes

## What works today

ChatGPT talks to Knowledge Hub through **Custom GPT → Actions** (OpenAPI + Bearer), not through Workspace MCP Apps (backlog NF-004).

## Setup checklist

1. Create a write-capable API client for the **AI Assistants** workspace allowlist.
2. Import \`/api/v1/llm/openapi.json\` from the public HTTPS origin.
3. Auth: API Key / Bearer with the raw hub token.
4. Chat **inside** that GPT when saving summaries to the hub.

## Moving older chats into the hub

1. Summarize decisions in the old thread.
2. Open the KnowHub Custom GPT.
3. Paste the summary and ask to search for duplicates, then create a **draft** knowledge record.
4. Review the draft in the web UI.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| \`@KnowHub\` unavailable | Open the Custom GPT directly |
| 401 from Actions | Rotate the API client token |
| Empty search | Wrong workspace allowlist on the client |
`;

    const records = [
      {
        title: 'Homelab platform overview',
        slug: 'homelab-platform-overview',
        summary: 'Architecture and networking for the home lab platform.',
        recordType: 'architecture',
        lifecycleStatus: 'current',
        projectId: labProject.id,
        systemId: knowhub.id,
        contentMarkdown: architectureMd,
      },
      {
        title: 'Knowledge Hub operator runbook',
        slug: 'knowledge-hub-operator-runbook',
        summary: 'Day-2 ops: health, MCP setup, and incident checks.',
        recordType: 'runbook',
        lifecycleStatus: 'verified',
        projectId: labProject.id,
        systemId: knowhub.id,
        contentMarkdown: runbookMd,
      },
      {
        title: 'Proxmox snapshot policy',
        slug: 'proxmox-snapshot-policy',
        summary: 'When to snapshot VMs before upgrades.',
        recordType: 'configuration',
        lifecycleStatus: 'draft',
        projectId: labProject.id,
        systemId: proxmox.id,
        contentMarkdown: `# Proxmox snapshot policy

## Before upgrades

Take a snapshot of guest VMs that hold durable state (Postgres, Redis) before package upgrades.

## Retention

Keep the last two successful snapshots; prune older ones weekly.

## Restore drill

Quarterly: restore a non-prod guest from snapshot and verify boot.
`,
      },
      {
        title: 'ChatGPT Custom GPT notes',
        slug: 'chatgpt-custom-gpt-notes',
        summary: 'How to use Actions vs @ mentions; saving drafts to the hub.',
        recordType: 'note',
        lifecycleStatus: 'current',
        projectId: aiProject.id,
        systemId: openwebui.id,
        contentMarkdown: chatgptNotesMd,
      },
      {
        title: 'OpenWebUI MCP connection',
        slug: 'openwebui-mcp-connection',
        summary: 'Native MCP Streamable HTTP setup for OpenWebUI.',
        recordType: 'installation-guide',
        lifecycleStatus: 'verified',
        projectId: aiProject.id,
        systemId: openwebui.id,
        contentMarkdown: `# OpenWebUI MCP connection

## Add the tool server

1. Admin → Settings → Integrations → Manage Tool Servers
2. Connection type: **MCP (Streamable HTTP)**
3. URL: public \`/mcp\` endpoint
4. Auth: Bearer hub token

## Access control

Grant read access or the server stays hidden. Enable tools in chat via **+ → Integrations → Tools**.

## Models

Prefer a tool-capable model; tiny local models often skip tools.
`,
      },
    ];

    for (const record of records) {
      await database.db.insert(knowledgeRecords).values({
        workspaceId: workspace.id,
        projectId: record.projectId,
        systemId: record.systemId,
        title: record.title,
        slug: record.slug,
        summary: record.summary,
        recordType: record.recordType,
        lifecycleStatus: record.lifecycleStatus,
        sourceOfTruthMode: 'hub_managed',
        contentMarkdown: record.contentMarkdown,
        createdBy: admin.id,
        verifiedAt:
          record.lifecycleStatus === 'verified' || record.lifecycleStatus === 'current'
            ? new Date()
            : null,
      });
    }

    // Final counts
    const [{ n: usersLeft }] = await database.db
      .select({ n: sql<number>`count(*)::int` })
      .from(users);
    const [{ n: wsLeft }] = await database.db
      .select({ n: sql<number>`count(*)::int` })
      .from(workspaces);
    const [{ n: recLeft }] = await database.db
      .select({ n: sql<number>`count(*)::int` })
      .from(knowledgeRecords);

    console.log('Done.');
    console.log(`  users=${usersLeft} workspaces=${wsLeft} knowledge_records=${recLeft}`);
    console.log(`  Sign in: ${admin.email} / (BOOTSTRAP_ADMIN_PASSWORD)`);
    console.log(`  Open: /workspaces/${DEMO_WORKSPACE_SLUG}`);
    console.log('  Try: Homelab Platform → linked systems + knowledge; long TOC on overview/runbook.');
  } finally {
    await database.close();
  }
}

main().catch((error: unknown) => {
  console.error('seed:demo failed', error);
  process.exit(1);
});
