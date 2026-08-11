/**
 * Dev-only: purge integration-test clutter and seed a realistic Home Infrastructure demo
 * plus extra workspaces/users for membership (role) testing.
 *
 * Keeps: organization `default`, workspace `home-infrastructure` (+ demo workspaces below),
 *        admin@localhost.local
 * Removes: *@example.com / *@demo.local users and non-default organizations (cascades).
 *
 * Usage: pnpm --filter @project-knowledge-hub/database seed:demo
 *    or: pnpm db:seed:demo
 */
import { and, eq, ne, not, inArray, sql } from 'drizzle-orm';
import { hashPassword } from '@project-knowledge-hub/auth';
import { loadEnv } from '@project-knowledge-hub/config';
import {
  createDatabase,
  apiClients,
  conversationImports,
  gitRepositoryConnections,
  knowledgeRecords,
  knowledgeRecordDeliveryLinks,
  knowledgeRecordVersions,
  memberships,
  organizations,
  projectChangeDeliveryLinks,
  projectChangeItems,
  projectCostSnapshots,
  projectEpics,
  projectInitialStakeholders,
  projectMilestones,
  projectRaidItems,
  projectRaidTaskLinks,
  projectSprints,
  projectStakeholders,
  projectTaskActivities,
  projectTaskRaci,
  projectTasks,
  projectUserStories,
  projects,
  systems,
  users,
  workspaces,
} from '@project-knowledge-hub/database';

/** Local calendar date YYYY-MM-DD offset from today (for Delivery calendar/board demos). */
function ymd(offsetDays: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Midday timestamp for activity trails (burndown / handoffs). */
function ymdAt(offsetDays: number): Date {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  date.setHours(12, 0, 0, 0);
  return date;
}

const DEMO_WORKSPACE_SLUG = 'home-infrastructure';
const DEMO_PASSWORD = 'change-me-demo-pass';

/** Extra workspaces kept across re-seeds (membership / role testing). */
const MEMBERSHIP_DEMO_WORKSPACES = [
  {
    slug: 'client-alpha',
    name: 'Client Alpha Delivery',
    description: 'Mock client delivery workspace for role testing.',
    color: 'ocean',
  },
  {
    slug: 'ops-sandbox',
    name: 'Ops Sandbox',
    description: 'Sandbox for ops experiments and limited access.',
    color: 'teal',
  },
  {
    slug: 'research-lab',
    name: 'Research Lab',
    description: 'Research notes and experiments (readers + maintainers).',
    color: 'violet',
  },
] as const;

const KEEP_WORKSPACE_SLUGS = [
  DEMO_WORKSPACE_SLUG,
  ...MEMBERSHIP_DEMO_WORKSPACES.map((item) => item.slug),
] as const;

type DemoRole = 'workspace_admin' | 'maintainer' | 'reader';

const MEMBERSHIP_DEMO_USERS: Array<{
  email: string;
  displayName: string;
  fullName: string;
  /** workspace slug → role */
  roles: Record<string, DemoRole>;
}> = [
  {
    email: 'alex.admin@demo.local',
    displayName: 'Alex Admin',
    fullName: 'Alex Rivera',
    roles: {
      'client-alpha': 'workspace_admin',
      [DEMO_WORKSPACE_SLUG]: 'reader',
    },
  },
  {
    email: 'blair.maintainer@demo.local',
    displayName: 'Blair Maintainer',
    fullName: 'Blair Chen',
    roles: {
      'client-alpha': 'maintainer',
      [DEMO_WORKSPACE_SLUG]: 'maintainer',
      'ops-sandbox': 'reader',
    },
  },
  {
    email: 'casey.reader@demo.local',
    displayName: 'Casey Reader',
    fullName: 'Casey Okonkwo',
    roles: {
      'client-alpha': 'reader',
    },
  },
  {
    email: 'dana.multi@demo.local',
    displayName: 'Dana Multi',
    fullName: 'Dana Kovács',
    roles: {
      'ops-sandbox': 'workspace_admin',
      'research-lab': 'maintainer',
      [DEMO_WORKSPACE_SLUG]: 'reader',
    },
  },
  {
    email: 'eli.reader@demo.local',
    displayName: 'Eli Reader',
    fullName: 'Eli Novak',
    roles: {
      'ops-sandbox': 'reader',
      'research-lab': 'reader',
    },
  },
];

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

    // Any leftover workspaces not in the demo keep-list
    const leftoverWs = await database.db
      .delete(workspaces)
      .where(not(inArray(workspaces.slug, [...KEEP_WORKSPACE_SLUGS])))
      .returning({ slug: workspaces.slug });
    if (leftoverWs.length > 0) {
      console.log(`  deleted ${leftoverWs.length} leftover workspaces`);
    }

    console.log('Removing *@example.com / *@demo.local test users…');
    // Clear version/record authorship that might still reference them in default workspace
    const testUsers = await database.db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(
        sql`${users.email} LIKE '%@example.com' OR ${users.email} LIKE '%@demo.local'`,
      );

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
        keyPrefix: 'HL1',
        definitionOfDone:
          '- Acceptance criteria met\n- Linked docs updated\n- RACI owner reviewed\n- No open critical RAID on the item',
        issueCounters: { SP: 3 },
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
        keyPrefix: 'AI1',
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
        systemType: 'ai_assistant',
        summary: 'Local chat UI with MCP tool servers.',
        ownerUserId: admin.id,
        metadataJson: { assistantBrand: 'openwebui' },
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

    // --- Membership / role demo workspaces + users ---
    console.log('Seeding membership demo workspaces and users…');
    const passwordHash = await hashPassword(DEMO_PASSWORD);
    const workspaceBySlug = new Map<string, string>([[workspace.slug, workspace.id]]);

    for (const spec of MEMBERSHIP_DEMO_WORKSPACES) {
      const [existing] = await database.db
        .select()
        .from(workspaces)
        .where(eq(workspaces.slug, spec.slug))
        .limit(1);
      if (existing) {
        await database.db
          .update(workspaces)
          .set({
            name: spec.name,
            description: spec.description,
            color: spec.color,
          })
          .where(eq(workspaces.id, existing.id));
        workspaceBySlug.set(spec.slug, existing.id);
      } else {
        const [created] = await database.db
          .insert(workspaces)
          .values({
            organizationId: workspace.organizationId,
            name: spec.name,
            slug: spec.slug,
            description: spec.description,
            color: spec.color,
          })
          .returning();
        if (!created) {
          throw new Error(`Failed to create workspace ${spec.slug}`);
        }
        workspaceBySlug.set(spec.slug, created.id);
      }

      // Admin can manage every demo workspace
      const wsId = workspaceBySlug.get(spec.slug)!;
      const [adminOnWs] = await database.db
        .select()
        .from(memberships)
        .where(
          and(eq(memberships.userId, admin.id), eq(memberships.workspaceId, wsId)),
        )
        .limit(1);
      if (!adminOnWs) {
        await database.db.insert(memberships).values({
          userId: admin.id,
          workspaceId: wsId,
          role: 'workspace_admin',
        });
      } else if (adminOnWs.role !== 'workspace_admin') {
        await database.db
          .update(memberships)
          .set({ role: 'workspace_admin' })
          .where(eq(memberships.id, adminOnWs.id));
      }
    }

    for (const demoUser of MEMBERSHIP_DEMO_USERS) {
      const email = demoUser.email.toLowerCase();
      const [created] = await database.db
        .insert(users)
        .values({
          email,
          displayName: demoUser.displayName,
          fullName: demoUser.fullName,
          passwordHash,
          status: 'active',
          isSystemAdmin: false,
        })
        .returning();
      if (!created) {
        throw new Error(`Failed to create user ${email}`);
      }

      for (const [wsSlug, role] of Object.entries(demoUser.roles)) {
        const wsId = workspaceBySlug.get(wsSlug);
        if (!wsId) {
          throw new Error(`Unknown workspace slug in demo roles: ${wsSlug}`);
        }
        await database.db.insert(memberships).values({
          userId: created.id,
          workspaceId: wsId,
          role,
        });
      }
      console.log(`  user ${email} → ${Object.keys(demoUser.roles).length} membership(s)`);
    }

    // --- Project Delivery (milestones / tasks / RACI) ---
    console.log('Seeding project delivery demo data…');
    const demoUserRows = await database.db
      .select()
      .from(users)
      .where(
        inArray(
          users.email,
          MEMBERSHIP_DEMO_USERS.map((item) => item.email.toLowerCase()),
        ),
      );
    const userByEmail = new Map(demoUserRows.map((row) => [row.email, row]));
    const blair = userByEmail.get('blair.maintainer@demo.local');
    const dana = userByEmail.get('dana.multi@demo.local');
    const alex = userByEmail.get('alex.admin@demo.local');
    if (!blair || !dana || !alex) {
      throw new Error('Expected demo users for delivery RACI seed');
    }

    // AI assistant systems for Stakeholders (after demo users exist for owners).
    // Homelab Platform + AI Assistants each get linked assistants (listing is per projectId).
    await database.db.insert(systems).values([
      {
        workspaceId: workspace.id,
        projectId: labProject.id,
        name: 'Cursor',
        slug: 'cursor-homelab',
        status: 'active',
        systemType: 'ai_assistant',
        summary: 'IDE agent for Homelab delivery via MCP Streamable HTTP.',
        ownerUserId: admin.id,
        metadataJson: { assistantBrand: 'cursor' },
      },
      {
        workspaceId: workspace.id,
        projectId: labProject.id,
        name: 'KnowHub Ops Agent',
        slug: 'knowhub-ops-agent',
        status: 'active',
        systemType: 'ai_assistant',
        summary: 'API-client agent for RAID, delivery, and budget updates on Homelab.',
        ownerUserId: blair.id,
        metadataJson: { assistantBrand: 'generic' },
      },
      {
        workspaceId: workspace.id,
        projectId: aiProject.id,
        name: 'Cursor',
        slug: 'cursor',
        status: 'active',
        systemType: 'ai_assistant',
        summary: 'IDE agent connected via MCP Streamable HTTP.',
        ownerUserId: admin.id,
        metadataJson: { assistantBrand: 'cursor' },
      },
      {
        workspaceId: workspace.id,
        projectId: aiProject.id,
        name: 'ChatGPT Custom GPT',
        slug: 'chatgpt-custom-gpt',
        status: 'active',
        systemType: 'ai_assistant',
        summary: 'Custom GPT Actions (OpenAPI + Bearer) against the hub API.',
        ownerUserId: blair.id,
        metadataJson: { assistantBrand: 'openai' },
      },
    ]);

    const [mNetwork] = await database.db
      .insert(projectMilestones)
      .values({
        projectId: labProject.id,
        title: 'Network edge hardening',
        description: 'TLS, Traefik routes, and split-DNS notes for public MCP.',
        status: 'done',
        startDate: ymd(-28),
        targetDate: ymd(-14),
        sortOrder: 10,
      })
      .returning();
    const [mObservability] = await database.db
      .insert(projectMilestones)
      .values({
        projectId: labProject.id,
        title: 'Observability baseline',
        description: 'Monitoring, alerts, and backup age stamps.',
        status: 'active',
        startDate: ymd(-7),
        targetDate: ymd(10),
        sortOrder: 20,
      })
      .returning();
    const [mDelivery] = await database.db
      .insert(projectMilestones)
      .values({
        projectId: labProject.id,
        title: 'Project Delivery MVP',
        description:
          'Milestones, tasks, RACI, list/board/calendar for humans + MCP agents.',
        status: 'active',
        startDate: ymd(0),
        targetDate: ymd(21),
        sortOrder: 30,
      })
      .returning();
    const [mDocsDay] = await database.db
      .insert(projectMilestones)
      .values({
        projectId: labProject.id,
        title: 'Docs & restore drill',
        description: 'Runbook refresh and restore rehearsal.',
        status: 'planned',
        startDate: ymd(28),
        targetDate: ymd(35),
        sortOrder: 40,
      })
      .returning();

    if (!mNetwork || !mObservability || !mDelivery || !mDocsDay) {
      throw new Error('Failed to create lab delivery milestones');
    }

    const [labEpic] = await database.db
      .insert(projectEpics)
      .values({
        projectId: labProject.id,
        title: 'Make Homelab operable for agents',
        description: 'Epic covering edge, observability, and delivery UX.',
        status: 'active',
        startDate: ymd(-30),
        endDate: ymd(40),
        sortOrder: 10,
      })
      .returning();
    if (!labEpic) {
      throw new Error('Failed to create lab epic');
    }
    const [storyEdge] = await database.db
      .insert(projectUserStories)
      .values({
        projectId: labProject.id,
        epicId: labEpic.id,
        title: 'As an operator I can expose MCP safely',
        description: 'Edge hardening stories for public MCP access.',
        status: 'done',
        startDate: ymd(-28),
        endDate: ymd(-10),
        sortOrder: 10,
      })
      .returning();
    const [storyDelivery] = await database.db
      .insert(projectUserStories)
      .values({
        projectId: labProject.id,
        epicId: labEpic.id,
        title: 'As a PM I can track work across stories',
        description: 'Delivery board, owners, and handoffs.',
        status: 'active',
        startDate: ymd(-5),
        endDate: ymd(25),
        sortOrder: 20,
      })
      .returning();
    if (!storyEdge || !storyDelivery) {
      throw new Error('Failed to create lab user stories');
    }

    console.log('Seeding Homelab Scrum sprints…');
    const [sprintCompleted] = await database.db
      .insert(projectSprints)
      .values({
        projectId: labProject.id,
        name: 'Sprint 1 — Edge hardening',
        goal: 'Ship Traefik → Authentik path and prove public MCP reachability.',
        status: 'completed',
        startDate: ymd(-21),
        endDate: ymd(-8),
        capacityPoints: 16,
        sortOrder: 10,
        issueKeyType: 'SP',
        issueNumber: 1,
      })
      .returning();
    const [sprintActive] = await database.db
      .insert(projectSprints)
      .values({
        projectId: labProject.id,
        name: 'Sprint 2 — Observability + Delivery UX',
        goal: 'Alerts on backups/disk and a usable Delivery board for agents.',
        status: 'active',
        startDate: ymd(-7),
        endDate: ymd(7),
        capacityPoints: 24,
        sortOrder: 20,
        issueKeyType: 'SP',
        issueNumber: 2,
      })
      .returning();
    const [sprintPlanned] = await database.db
      .insert(projectSprints)
      .values({
        projectId: labProject.id,
        name: 'Sprint 3 — Docs & restore',
        goal: 'Restore drill scheduled and Homelab runbook refreshed.',
        status: 'planned',
        startDate: ymd(8),
        endDate: ymd(21),
        capacityPoints: 18,
        sortOrder: 30,
        issueKeyType: 'SP',
        issueNumber: 3,
      })
      .returning();
    if (!sprintCompleted || !sprintActive || !sprintPlanned) {
      throw new Error('Failed to create lab sprints');
    }

    type SeedTask = {
      milestoneId: string | null;
      userStoryId?: string | null;
      sprintId?: string | null;
      storyPoints?: number | null;
      /** Offset used for status_changed→done activity (burndown). */
      doneOnOffset?: number;
      title: string;
      description?: string;
      status: string;
      dueDate: string | null;
      forecastHours?: string | null;
      actualHours?: string | null;
      sortOrder: number;
      raci: Array<{ userId: string; role: 'R' | 'A' | 'C' | 'I' }>;
    };

    const labTasks: SeedTask[] = [
      {
        milestoneId: mNetwork.id,
        userStoryId: storyEdge.id,
        sprintId: sprintCompleted.id,
        storyPoints: 5,
        doneOnOffset: -16,
        title: 'Document Traefik → Authentik Tailscale route',
        status: 'done',
        dueDate: ymd(-20),
        forecastHours: '8',
        actualHours: '9.5',
        sortOrder: 1,
        raci: [
          { userId: admin.id, role: 'A' },
          { userId: blair.id, role: 'R' },
        ],
      },
      {
        milestoneId: mNetwork.id,
        userStoryId: storyEdge.id,
        sprintId: sprintCompleted.id,
        storyPoints: 3,
        doneOnOffset: -11,
        title: 'Verify public MCP URL from mobile data',
        status: 'done',
        dueDate: ymd(-12),
        forecastHours: '4',
        actualHours: '3.5',
        sortOrder: 2,
        raci: [
          { userId: blair.id, role: 'A' },
          { userId: admin.id, role: 'C' },
        ],
      },
      {
        milestoneId: mObservability.id,
        sprintId: sprintActive.id,
        storyPoints: 5,
        doneOnOffset: -2,
        title: 'Wire ALERT_WEBHOOK_URL for backup failures',
        status: 'done',
        dueDate: ymd(3),
        forecastHours: '6',
        actualHours: '5.5',
        sortOrder: 1,
        raci: [
          { userId: admin.id, role: 'A' },
          { userId: blair.id, role: 'R' },
          { userId: dana.id, role: 'I' },
        ],
      },
      {
        milestoneId: mObservability.id,
        sprintId: sprintActive.id,
        storyPoints: 3,
        title: 'Add disk-space alert for Postgres volume',
        status: 'todo',
        dueDate: ymd(7),
        forecastHours: '5',
        sortOrder: 2,
        raci: [
          { userId: blair.id, role: 'A' },
          { userId: admin.id, role: 'R' },
        ],
      },
      {
        milestoneId: mObservability.id,
        sprintId: sprintActive.id,
        storyPoints: 2,
        title: 'Review Monitoring Mon-2 search telemetry',
        status: 'blocked',
        dueDate: ymd(5),
        forecastHours: '3',
        actualHours: '1',
        description: 'Waiting on sample traffic from staging smoke.',
        sortOrder: 3,
        raci: [
          { userId: admin.id, role: 'A' },
          { userId: dana.id, role: 'C' },
        ],
      },
      {
        milestoneId: mDelivery.id,
        userStoryId: storyDelivery.id,
        sprintId: sprintActive.id,
        storyPoints: 5,
        title: 'Seed demo milestones/tasks for UI validation',
        status: 'in_progress',
        dueDate: ymd(0),
        forecastHours: '10',
        actualHours: '7',
        sortOrder: 1,
        raci: [
          { userId: admin.id, role: 'A' },
          { userId: blair.id, role: 'R' },
        ],
      },
      {
        milestoneId: mDelivery.id,
        userStoryId: storyDelivery.id,
        sprintId: sprintActive.id,
        storyPoints: 3,
        title: 'Validate list / board / calendar views',
        status: 'todo',
        dueDate: ymd(2),
        forecastHours: '8',
        sortOrder: 2,
        raci: [
          { userId: blair.id, role: 'A' },
          { userId: admin.id, role: 'R' },
          { userId: alex.id, role: 'I' },
        ],
      },
      {
        milestoneId: mDelivery.id,
        userStoryId: storyDelivery.id,
        sprintId: sprintActive.id,
        storyPoints: 2,
        title: 'MCP smoke: create_project_task + set RACI',
        status: 'todo',
        dueDate: ymd(4),
        forecastHours: '4',
        sortOrder: 3,
        raci: [
          { userId: admin.id, role: 'A' },
          { userId: blair.id, role: 'R' },
        ],
      },
      {
        milestoneId: mDelivery.id,
        userStoryId: storyDelivery.id,
        sprintId: sprintPlanned.id,
        storyPoints: 5,
        title: 'Polish board drag-and-drop affordances',
        status: 'todo',
        dueDate: ymd(12),
        forecastHours: '6',
        sortOrder: 4,
        raci: [
          { userId: blair.id, role: 'A' },
          { userId: dana.id, role: 'C' },
        ],
      },
      {
        milestoneId: mDocsDay.id,
        sprintId: sprintPlanned.id,
        storyPoints: 8,
        title: 'Schedule Postgres restore drill',
        status: 'todo',
        dueDate: ymd(28),
        forecastHours: '12',
        sortOrder: 1,
        raci: [
          { userId: admin.id, role: 'A' },
          { userId: blair.id, role: 'R' },
        ],
      },
      {
        milestoneId: mDocsDay.id,
        sprintId: sprintPlanned.id,
        storyPoints: 5,
        title: 'Refresh Homelab runbook after Delivery ships',
        status: 'todo',
        dueDate: ymd(30),
        forecastHours: '8',
        sortOrder: 2,
        raci: [
          { userId: dana.id, role: 'A' },
          { userId: admin.id, role: 'R' },
          { userId: blair.id, role: 'C' },
        ],
      },
      {
        milestoneId: null,
        title: 'Triage leftover Docker volume usage',
        status: 'cancelled',
        dueDate: ymd(-3),
        forecastHours: '2',
        actualHours: '0.5',
        sortOrder: 99,
        raci: [{ userId: admin.id, role: 'A' }],
      },
      {
        milestoneId: null,
        storyPoints: 3,
        title: 'Capture GPU host decision for embeddings',
        status: 'todo',
        dueDate: ymd(14),
        forecastHours: '3',
        sortOrder: 50,
        raci: [
          { userId: admin.id, role: 'A' },
          { userId: alex.id, role: 'C' },
          { userId: blair.id, role: 'I' },
        ],
      },
    ];

    let handoffDemoTaskId: string | null = null;
    for (const taskSpec of labTasks) {
      const ownerUserId =
        taskSpec.raci.find((entry) => entry.role === 'R')?.userId ??
        taskSpec.raci.find((entry) => entry.role === 'A')?.userId ??
        admin.id;
      const [task] = await database.db
        .insert(projectTasks)
        .values({
          projectId: labProject.id,
          milestoneId: taskSpec.milestoneId,
          userStoryId: taskSpec.userStoryId ?? null,
          sprintId: taskSpec.sprintId ?? null,
          storyPoints: taskSpec.storyPoints ?? null,
          title: taskSpec.title,
          description: taskSpec.description ?? null,
          status: taskSpec.status,
          dueDate: taskSpec.dueDate,
          forecastHours: taskSpec.forecastHours ?? null,
          actualHours: taskSpec.actualHours ?? null,
          sortOrder: taskSpec.sortOrder,
          createdBy: admin.id,
          currentOwnerUserId: ownerUserId,
        })
        .returning();
      if (!task) {
        throw new Error(`Failed to create task: ${taskSpec.title}`);
      }
      if (taskSpec.raci.length > 0) {
        await database.db.insert(projectTaskRaci).values(
          taskSpec.raci.map((entry) => ({
            taskId: task.id,
            userId: entry.userId,
            role: entry.role,
          })),
        );
      }
      await database.db.insert(projectTaskActivities).values({
        taskId: task.id,
        actorUserId: admin.id,
        type: 'created',
        metadataJson: { title: task.title },
        createdAt: ymdAt(
          taskSpec.doneOnOffset != null ? taskSpec.doneOnOffset - 3 : -10,
        ),
      });
      if (taskSpec.status === 'done' && taskSpec.doneOnOffset != null) {
        await database.db.insert(projectTaskActivities).values({
          taskId: task.id,
          actorUserId: admin.id,
          type: 'status_changed',
          metadataJson: { from: 'in_progress', to: 'done' },
          createdAt: ymdAt(taskSpec.doneOnOffset),
        });
      }
      if (taskSpec.title === 'Validate list / board / calendar views') {
        handoffDemoTaskId = task.id;
      }
    }

    if (handoffDemoTaskId) {
      await database.db
        .update(projectTasks)
        .set({ currentOwnerUserId: dana.id, updatedAt: new Date() })
        .where(eq(projectTasks.id, handoffDemoTaskId));
      await database.db.insert(projectTaskActivities).values([
        {
          taskId: handoffDemoTaskId,
          actorUserId: blair.id,
          type: 'comment',
          body: 'Board looks good on desktop; checking mobile columns next.',
        },
        {
          taskId: handoffDemoTaskId,
          actorUserId: blair.id,
          type: 'handoff',
          body: 'Please sanity-check the calendar agenda view.',
          metadataJson: { fromUserId: blair.id, toUserId: dana.id },
        },
      ]);
    }

    const labTaskRows = await database.db
      .select({ id: projectTasks.id, title: projectTasks.title })
      .from(projectTasks)
      .where(eq(projectTasks.projectId, labProject.id));
    const taskIdByTitle = new Map(labTaskRows.map((row) => [row.title, row.id]));
    const diskAlertTaskId = taskIdByTitle.get(
      'Add disk-space alert for Postgres volume',
    );
    const monitoringTaskId = taskIdByTitle.get(
      'Review Monitoring Mon-2 search telemetry',
    );

    const [riskRaid] = await database.db
      .insert(projectRaidItems)
      .values({
        projectId: labProject.id,
        kind: 'risk',
        title: 'Public MCP exposure without Tailscale ACL review',
        description:
          'If edge auth drifts, agent tokens could be reachable from the public internet.',
        status: 'mitigating',
        severity: 'high',
        ownerUserId: blair.id,
        dueDate: ymd(10),
        sortOrder: 10,
      })
      .returning();
    const [assumptionRaid] = await database.db
      .insert(projectRaidItems)
      .values({
        projectId: labProject.id,
        kind: 'assumption',
        title: 'Staging smoke traffic will unblock Mon-2 review',
        description: 'Assumes staging generates enough search events this week.',
        status: 'open',
        severity: 'medium',
        ownerUserId: dana.id,
        dueDate: ymd(5),
        sortOrder: 20,
      })
      .returning();
    const [issueRaid] = await database.db
      .insert(projectRaidItems)
      .values({
        projectId: labProject.id,
        kind: 'issue',
        title: 'Postgres volume nearing capacity on lab host',
        description: 'Disk-space alert work is tracking the fix.',
        status: 'open',
        severity: 'critical',
        ownerUserId: admin.id,
        dueDate: ymd(7),
        sortOrder: 30,
      })
      .returning();
    const [dependencyRaid] = await database.db
      .insert(projectRaidItems)
      .values({
        projectId: labProject.id,
        kind: 'dependency',
        title: 'Depends on Authentik email_verified mapping',
        description: 'SSO smoke for maintainers waits on IdP claim mapping.',
        status: 'accepted',
        severity: 'medium',
        ownerUserId: alex.id,
        sortOrder: 40,
      })
      .returning();

    if (!riskRaid || !assumptionRaid || !issueRaid || !dependencyRaid) {
      throw new Error('Failed to create lab RAID items');
    }

    const raidTaskPairs: Array<{ raidItemId: string; taskId: string }> = [];
    if (handoffDemoTaskId) {
      raidTaskPairs.push({
        raidItemId: riskRaid.id,
        taskId: handoffDemoTaskId,
      });
    }
    if (monitoringTaskId) {
      raidTaskPairs.push({
        raidItemId: assumptionRaid.id,
        taskId: monitoringTaskId,
      });
    }
    if (diskAlertTaskId) {
      raidTaskPairs.push({
        raidItemId: issueRaid.id,
        taskId: diskAlertTaskId,
      });
    }
    if (raidTaskPairs.length > 0) {
      await database.db.insert(projectRaidTaskLinks).values(raidTaskPairs);
    }

    const [charterRecord] = await database.db
      .insert(knowledgeRecords)
      .values({
        workspaceId: workspace.id,
        projectId: labProject.id,
        systemId: knowhub.id,
        title: 'Homelab Knowledge Hub project charter',
        slug: 'homelab-project-charter',
        summary: 'Purpose, scope, and success criteria for the lab KnowHub project.',
        recordType: 'project-charter',
        lifecycleStatus: 'current',
        sourceOfTruthMode: 'hub_managed',
        contentMarkdown: `# Homelab Knowledge Hub project charter

## Purpose

Operate KnowHub as the shared system of record for lab knowledge and delivery.

## In scope

- Knowledge ledger, delivery hierarchy, RAID register, MCP agent access

## Success criteria

- Maintainers can track epics/stories/tasks and RAID in one project page
`,
        createdBy: admin.id,
        verifiedAt: new Date(),
      })
      .returning();
    const [minutesRecord] = await database.db
      .insert(knowledgeRecords)
      .values({
        workspaceId: workspace.id,
        projectId: labProject.id,
        systemId: knowhub.id,
        title: 'Delivery UX sync — meeting minutes',
        slug: 'delivery-ux-sync-minutes',
        summary: 'Notes from the delivery board / calendar review sync.',
        recordType: 'meeting-minutes',
        lifecycleStatus: 'draft',
        sourceOfTruthMode: 'hub_managed',
        contentMarkdown: `# Delivery UX sync

## Attendees

Blair, Dana, Admin

## Decisions

- Keep milestones as timeboxes; epics/stories for hierarchy
- Hand off calendar check to Dana

## Actions

- Validate list / board / calendar views
`,
        createdBy: admin.id,
      })
      .returning();
    const [decisionRecord] = await database.db
      .insert(knowledgeRecords)
      .values({
        workspaceId: workspace.id,
        projectId: labProject.id,
        systemId: knowhub.id,
        title: 'Decision: public MCP stays behind Authentik',
        slug: 'decision-public-mcp-authentik',
        summary: 'Decision-making record for edge auth on the MCP endpoint.',
        recordType: 'decision',
        lifecycleStatus: 'verified',
        sourceOfTruthMode: 'hub_managed',
        contentMarkdown: `# Decision: public MCP stays behind Authentik

## Context

Agents need remote access; raw token exposure is unacceptable.

## Decision

Keep public MCP behind Authentik + Tailscale ACL review.

## Consequences

- RAID risk tracked until ACL review completes
`,
        createdBy: admin.id,
        verifiedAt: new Date(),
      })
      .returning();

    const [planRecord] = await database.db
      .insert(knowledgeRecords)
      .values({
        workspaceId: workspace.id,
        projectId: labProject.id,
        systemId: knowhub.id,
        title: 'Homelab Knowledge Hub initial plan',
        slug: 'homelab-initial-plan',
        summary: 'Kickoff plan: phases, windows, and delivery milestones.',
        recordType: 'plan',
        lifecycleStatus: 'current',
        sourceOfTruthMode: 'hub_managed',
        contentMarkdown: `# Homelab Knowledge Hub initial plan

## Window

- Start: lab edge hardening
- End: docs & restore drill

## Phases

1. Network edge
2. Observability
3. Delivery UX
4. Docs & restore
`,
        createdBy: admin.id,
        verifiedAt: new Date(),
      })
      .returning();

    const [retroRecord] = await database.db
      .insert(knowledgeRecords)
      .values({
        workspaceId: workspace.id,
        projectId: labProject.id,
        systemId: knowhub.id,
        title: 'Retrospective — Sprint 1 — Edge hardening',
        slug: 'retro-sprint-1-edge-hardening',
        summary: 'What went well / improve after edge hardening sprint.',
        recordType: 'sprint_retrospective',
        lifecycleStatus: 'verified',
        sourceOfTruthMode: 'hub_managed',
        documentKeyType: 'RET',
        documentNumber: 1,
        contentMarkdown: `# Retrospective — Sprint 1

## Went well

- Traefik → Authentik path documented end-to-end
- Mobile MCP reachability proven early

## Improve

- Pair on ACL review before the next public exposure

## Actions

- Carry monitoring telemetry review into Sprint 2
`,
        createdBy: admin.id,
        verifiedAt: new Date(),
      })
      .returning();
    const [reviewRecord] = await database.db
      .insert(knowledgeRecords)
      .values({
        workspaceId: workspace.id,
        projectId: labProject.id,
        systemId: knowhub.id,
        title: 'Sprint review — Sprint 1 — Edge hardening',
        slug: 'review-sprint-1-edge-hardening',
        summary: 'Demo notes for completed edge hardening sprint.',
        recordType: 'sprint_review',
        lifecycleStatus: 'current',
        sourceOfTruthMode: 'hub_managed',
        documentKeyType: 'REV',
        documentNumber: 1,
        contentMarkdown: `# Sprint review — Sprint 1

## Demo

- Public MCP URL behind Authentik
- Tailscale route notes in knowledge

## Accepted

- 8 story points completed (capacity 16)
`,
        createdBy: admin.id,
        verifiedAt: new Date(),
      })
      .returning();

    if (
      !charterRecord ||
      !minutesRecord ||
      !decisionRecord ||
      !planRecord ||
      !retroRecord ||
      !reviewRecord
    ) {
      throw new Error('Failed to create delivery-linked demo documents');
    }

    await database.db
      .update(projects)
      .set({
        startDate: ymd(-30),
        endDate: ymd(45),
        currency: 'EUR',
        initialBudget: '48000.00',
        approvedBudget: '52000.00',
        charterRecordId: charterRecord.id,
        initialPlanRecordId: planRecord.id,
        issueCounters: { SP: 3, RET: 1, REV: 1 },
        updatedAt: new Date(),
      })
      .where(eq(projects.id, labProject.id));

    await database.db.insert(projectInitialStakeholders).values([
      {
        projectId: labProject.id,
        userId: admin.id,
        projectRole: 'sponsor',
        sortOrder: 10,
      },
      {
        projectId: labProject.id,
        userId: blair.id,
        projectRole: 'tech_lead',
        sortOrder: 20,
      },
      {
        projectId: labProject.id,
        userId: dana.id,
        projectRole: 'product_owner',
        sortOrder: 30,
      },
    ]);

    const [timelineChange] = await database.db
      .insert(projectChangeItems)
      .values({
        projectId: labProject.id,
        kind: 'timeline',
        title: 'Slip docs day by one week',
        description: 'Restore drill conflicts with authentik maintenance.',
        rationale: 'Keep edge hardening window; move docs milestone only.',
        status: 'approved',
        requestedByUserId: blair.id,
        approvedByUserId: admin.id,
        effectiveDate: ymd(0),
        baselineStartBefore: ymd(-30),
        baselineStartAfter: ymd(-30),
        baselineEndBefore: ymd(38),
        baselineEndAfter: ymd(45),
        knowledgeRecordId: planRecord.id,
        sortOrder: 10,
      })
      .returning();
    const [scopeChange] = await database.db
      .insert(projectChangeItems)
      .values({
        projectId: labProject.id,
        kind: 'scope',
        title: 'Add fishbone timeline view to Delivery',
        description: 'Baseline + change register require a schedule swimlane.',
        rationale: 'Operators need duration bars without a full Gantt.',
        status: 'implemented',
        requestedByUserId: dana.id,
        approvedByUserId: blair.id,
        effectiveDate: ymd(-2),
        knowledgeRecordId: charterRecord.id,
        sortOrder: 20,
      })
      .returning();
    if (!timelineChange || !scopeChange) {
      throw new Error('Failed to create lab change items');
    }
    await database.db.insert(projectChangeDeliveryLinks).values([
      {
        changeId: timelineChange.id,
        entityType: 'milestone',
        entityId: mDocsDay.id,
      },
      {
        changeId: scopeChange.id,
        entityType: 'epic',
        entityId: labEpic.id,
      },
      {
        changeId: scopeChange.id,
        entityType: 'user_story',
        entityId: storyDelivery.id,
      },
    ]);

    await database.db.insert(knowledgeRecordDeliveryLinks).values([
      {
        knowledgeRecordId: charterRecord.id,
        entityType: 'epic',
        entityId: labEpic.id,
      },
      {
        knowledgeRecordId: minutesRecord.id,
        entityType: 'user_story',
        entityId: storyDelivery.id,
      },
      ...(handoffDemoTaskId
        ? [
            {
              knowledgeRecordId: minutesRecord.id,
              entityType: 'task',
              entityId: handoffDemoTaskId,
            },
          ]
        : []),
      {
        knowledgeRecordId: decisionRecord.id,
        entityType: 'epic',
        entityId: labEpic.id,
      },
      {
        knowledgeRecordId: decisionRecord.id,
        entityType: 'user_story',
        entityId: storyEdge.id,
      },
      {
        knowledgeRecordId: retroRecord.id,
        entityType: 'sprint',
        entityId: sprintCompleted.id,
      },
      {
        knowledgeRecordId: reviewRecord.id,
        entityType: 'sprint',
        entityId: sprintCompleted.id,
      },
    ]);

    const [aiM1] = await database.db
      .insert(projectMilestones)
      .values({
        projectId: aiProject.id,
        title: 'Assistant onboarding pack',
        description: 'MCP wizard docs + sample API client scopes.',
        status: 'active',
        targetDate: ymd(8),
        sortOrder: 10,
      })
      .returning();
    if (!aiM1) {
      throw new Error('Failed to create AI Assistants milestone');
    }

    const aiTasks: SeedTask[] = [
      {
        milestoneId: aiM1.id,
        title: 'Document pm:read / pm:write for Cursor clients',
        status: 'in_progress',
        dueDate: ymd(1),
        sortOrder: 1,
        raci: [
          { userId: admin.id, role: 'A' },
          { userId: blair.id, role: 'R' },
        ],
      },
      {
        milestoneId: aiM1.id,
        title: 'Record ChatGPT Actions timeout notes',
        status: 'todo',
        dueDate: ymd(6),
        sortOrder: 2,
        raci: [
          { userId: blair.id, role: 'A' },
          { userId: dana.id, role: 'R' },
        ],
      },
      {
        milestoneId: null,
        title: 'Spike: agent proposes tasks from meeting notes',
        status: 'todo',
        dueDate: ymd(18),
        sortOrder: 3,
        raci: [
          { userId: admin.id, role: 'A' },
          { userId: alex.id, role: 'I' },
        ],
      },
    ];

    for (const taskSpec of aiTasks) {
      const ownerUserId =
        taskSpec.raci.find((entry) => entry.role === 'R')?.userId ??
        taskSpec.raci.find((entry) => entry.role === 'A')?.userId ??
        admin.id;
      const [task] = await database.db
        .insert(projectTasks)
        .values({
          projectId: aiProject.id,
          milestoneId: taskSpec.milestoneId,
          userStoryId: taskSpec.userStoryId ?? null,
          title: taskSpec.title,
          description: taskSpec.description ?? null,
          status: taskSpec.status,
          dueDate: taskSpec.dueDate,
          sortOrder: taskSpec.sortOrder,
          createdBy: admin.id,
          currentOwnerUserId: ownerUserId,
        })
        .returning();
      if (!task) {
        throw new Error(`Failed to create AI task: ${taskSpec.title}`);
      }
      if (taskSpec.raci.length > 0) {
        await database.db.insert(projectTaskRaci).values(
          taskSpec.raci.map((entry) => ({
            taskId: task.id,
            userId: entry.userId,
            role: entry.role,
          })),
        );
      }
      await database.db.insert(projectTaskActivities).values({
        taskId: task.id,
        actorUserId: admin.id,
        type: 'created',
        metadataJson: { title: task.title },
      });
    }

    // Stakeholders roster + reporting chain (overlaps RACI users)
    console.log('Seeding project stakeholders…');
    await database.db.insert(projectStakeholders).values([
      {
        projectId: labProject.id,
        userId: alex.id,
        projectRole: 'sponsor',
        jobTitle: 'Executive sponsor',
        notes: 'Escalation for budget and priority calls.',
        hourlyRate: '160.00',
        reportsToUserId: null,
        sortOrder: 0,
      },
      {
        projectId: labProject.id,
        userId: admin.id,
        projectRole: 'owner',
        jobTitle: 'Project owner',
        notes: 'Day-to-day accountable for Homelab Platform.',
        hourlyRate: '95.00',
        reportsToUserId: alex.id,
        sortOrder: 10,
      },
      {
        projectId: labProject.id,
        userId: blair.id,
        projectRole: 'tech_lead',
        jobTitle: 'Platform tech lead',
        notes: 'Primary contact for infra and delivery questions.',
        hourlyRate: '85.00',
        reportsToUserId: admin.id,
        sortOrder: 20,
      },
      {
        projectId: labProject.id,
        userId: dana.id,
        projectRole: 'contributor',
        jobTitle: 'Docs & enablement',
        notes: 'Runbooks, onboarding, informed on ops alerts.',
        hourlyRate: '70.00',
        reportsToUserId: blair.id,
        sortOrder: 30,
      },
    ]);

    // Daily cost snapshots for Budgeting burndown (pragmatic EVM demo)
    console.log('Seeding project cost snapshots…');
    await database.db.insert(projectCostSnapshots).values([
      {
        projectId: labProject.id,
        capturedOn: ymd(-21),
        bac: '52000.00',
        pv: '7280.00',
        ev: '680.00',
        ac: '807.50',
      },
      {
        projectId: labProject.id,
        capturedOn: ymd(-14),
        bac: '52000.00',
        pv: '14560.00',
        ev: '1275.00',
        ac: '1487.50',
      },
      {
        projectId: labProject.id,
        capturedOn: ymd(-7),
        bac: '52000.00',
        pv: '21840.00',
        ev: '1275.00',
        ac: '1912.50',
      },
      {
        projectId: labProject.id,
        capturedOn: ymd(0),
        bac: '52000.00',
        pv: '20800.00',
        ev: '1275.00',
        ac: '2337.50',
      },
    ]);

    const [milestoneCount] = await database.db
      .select({ n: sql<number>`count(*)::int` })
      .from(projectMilestones);
    const [taskCount] = await database.db
      .select({ n: sql<number>`count(*)::int` })
      .from(projectTasks);
    const [sprintCount] = await database.db
      .select({ n: sql<number>`count(*)::int` })
      .from(projectSprints);
    const [stakeholderCount] = await database.db
      .select({ n: sql<number>`count(*)::int` })
      .from(projectStakeholders);

    // Final counts
    const [usersCount] = await database.db
      .select({ n: sql<number>`count(*)::int` })
      .from(users);
    const [wsCount] = await database.db
      .select({ n: sql<number>`count(*)::int` })
      .from(workspaces);
    const [recCount] = await database.db
      .select({ n: sql<number>`count(*)::int` })
      .from(knowledgeRecords);
    const [memCount] = await database.db
      .select({ n: sql<number>`count(*)::int` })
      .from(memberships);

    console.log('Done.');
    console.log(
      `  users=${usersCount?.n ?? 0} workspaces=${wsCount?.n ?? 0} knowledge_records=${recCount?.n ?? 0} memberships=${memCount?.n ?? 0}`,
    );
    console.log(
      `  delivery: milestones=${milestoneCount?.n ?? 0} tasks=${taskCount?.n ?? 0} sprints=${sprintCount?.n ?? 0} stakeholders=${stakeholderCount?.n ?? 0}`,
    );
    console.log(`  Sign in (admin): ${admin.email} / (BOOTSTRAP_ADMIN_PASSWORD)`);
    console.log(`  Demo users password: ${DEMO_PASSWORD}`);
    console.log('  Demo users:');
    for (const demoUser of MEMBERSHIP_DEMO_USERS) {
      const roleSummary = Object.entries(demoUser.roles)
        .map(([slug, role]) => `${slug}:${role}`)
        .join(', ');
      console.log(`    ${demoUser.email} — ${roleSummary}`);
    }
    console.log(`  Open: /workspaces/${DEMO_WORKSPACE_SLUG} or Admin → Memberships`);
    console.log(
      '  Try: Homelab Platform → Delivery (Scrum view: HL1-SP-1..3, burndown, DoD, retro/review) + Stakeholders; AI Assistants has its own board + OpenWebUI/Cursor/ChatGPT.',
    );

  } finally {
    await database.close();
  }
}

main().catch((error: unknown) => {
  console.error('seed:demo failed', error);
  process.exit(1);
});
