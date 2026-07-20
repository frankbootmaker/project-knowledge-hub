import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import { hashPassword } from '@project-knowledge-hub/auth';
import { loadEnv } from '@project-knowledge-hub/config';
import {
  createDatabase,
  memberships,
  organizations,
  users,
  workspaces,
} from '@project-knowledge-hub/database';
import { buildApp } from '../app.js';
import type { FastifyInstance } from 'fastify';

const hasIntegrationEnv =
  Boolean(process.env.DATABASE_URL) && Boolean(process.env.REDIS_URL);

function testEnv() {
  return loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    APP_ENV: 'test',
    LOG_LEVEL: 'silent',
    SESSION_SECRET:
      process.env.SESSION_SECRET ?? 'test-session-secret-at-least-32-chars',
    WEB_URL: process.env.WEB_URL ?? 'http://localhost:3100',
  });
}

describe.skipIf(!hasIntegrationEnv)('Conversation imports', () => {
  let app: FastifyInstance | undefined;
  let redis: Redis | undefined;
  let closeDatabase: (() => Promise<void>) | undefined;
  let adminCookie = '';
  let readerCookie = '';
  let workspaceId = '';
  let workspaceSlug = '';
  const password = 'test-password-123';

  beforeAll(async () => {
    const env = testEnv();
    const database = createDatabase(env.DATABASE_URL);
    closeDatabase = () => database.close();
    redis = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      enableOfflineQueue: false,
      retryStrategy: () => null,
    });
    await redis.connect();

    const suffix = randomUUID();
    const [org] = await database.db
      .insert(organizations)
      .values({ name: `Org M9 ${suffix}`, slug: `org-m9-${suffix}` })
      .returning();
    if (!org) {
      throw new Error('org missing');
    }

    const [admin] = await database.db
      .insert(users)
      .values({
        email: `admin-m9-${suffix}@example.com`,
        displayName: 'Admin',
        passwordHash: await hashPassword(password),
        isSystemAdmin: true,
        status: 'active',
      })
      .returning();
    const [reader] = await database.db
      .insert(users)
      .values({
        email: `reader-m9-${suffix}@example.com`,
        displayName: 'Reader',
        passwordHash: await hashPassword(password),
        isSystemAdmin: false,
        status: 'active',
      })
      .returning();
    if (!admin || !reader) {
      throw new Error('users missing');
    }

    const [workspace] = await database.db
      .insert(workspaces)
      .values({
        organizationId: org.id,
        name: `WS M9 ${suffix}`,
        slug: `ws-m9-${suffix}`,
      })
      .returning();
    if (!workspace) {
      throw new Error('workspace missing');
    }
    workspaceId = workspace.id;
    workspaceSlug = workspace.slug;

    await database.db.insert(memberships).values({
      userId: reader.id,
      workspaceId: workspace.id,
      role: 'reader',
    });

    app = await buildApp({ env, database, redis });
    await app.ready();

    const adminLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: admin.email, password },
    });
    adminCookie = `${env.SESSION_COOKIE_NAME}=${adminLogin.cookies.find((c) => c.name === env.SESSION_COOKIE_NAME)?.value}`;

    const readerLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: reader.email, password },
    });
    readerCookie = `${env.SESSION_COOKIE_NAME}=${readerLogin.cookies.find((c) => c.name === env.SESSION_COOKIE_NAME)?.value}`;
  });

  afterAll(async () => {
    await app?.close();
    await redis?.quit();
    await closeDatabase?.();
  });

  it('creates an import, draft record with provenance, and archives the import', async () => {
    if (!app) {
      throw new Error('app missing');
    }

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/conversation-imports',
      headers: { cookie: adminCookie, origin: 'http://localhost:3100' },
      payload: {
        workspaceId,
        title: 'Deploy chat',
        contentFormat: 'markdown',
        rawContent: '# Notes\n\nWe should ship M9 first.\n\n## Risks\n\nNone.',
        generatedByModel: 'test-model',
      },
    });
    expect(createRes.statusCode).toBe(200);
    const created = createRes.json() as {
      conversationImport: { id: string; rawContent: string; title: string };
    };
    expect(created.conversationImport.title).toBe('Deploy chat');
    expect(created.conversationImport.rawContent).toContain('ship M9');

    const readerCreate = await app.inject({
      method: 'POST',
      url: '/api/v1/conversation-imports',
      headers: { cookie: readerCookie, origin: 'http://localhost:3100' },
      payload: {
        workspaceId,
        title: 'Blocked',
        rawContent: 'nope',
      },
    });
    expect(readerCreate.statusCode).toBe(403);

    const draftRes = await app.inject({
      method: 'POST',
      url: `/api/v1/conversation-imports/${created.conversationImport.id}/records`,
      headers: { cookie: adminCookie, origin: 'http://localhost:3100' },
      payload: {
        title: 'M9 shipping notes',
        recordType: 'conversation-summary',
        contentMarkdown: 'We should ship M9 first.',
        excerptNote: 'Decision excerpt',
      },
    });
    expect(draftRes.statusCode).toBe(200);
    const draftPayload = draftRes.json() as {
      knowledgeRecord: {
        id: string;
        slug: string;
        lifecycleStatus: string;
        sourceOfTruthMode: string;
        contentMarkdown: string;
        source: {
          sourceType: string;
          sourceReference: string;
          sourceTitle: string;
          generatedByModel: string | null;
        } | null;
      };
      conversationImport: {
        linkedRecords: Array<{ knowledgeRecordId: string; excerptNote: string | null }>;
      };
    };
    expect(draftPayload.knowledgeRecord.lifecycleStatus).toBe('draft');
    expect(draftPayload.knowledgeRecord.sourceOfTruthMode).toBe('imported_snapshot');
    expect(draftPayload.knowledgeRecord.contentMarkdown).toBe('We should ship M9 first.');
    expect(draftPayload.knowledgeRecord.source?.sourceType).toBe('conversation');
    expect(draftPayload.knowledgeRecord.source?.sourceReference).toBe(
      created.conversationImport.id,
    );
    expect(draftPayload.knowledgeRecord.source?.sourceTitle).toBe('Deploy chat');
    expect(draftPayload.knowledgeRecord.source?.generatedByModel).toBe('test-model');
    expect(draftPayload.conversationImport.linkedRecords).toHaveLength(1);
    expect(draftPayload.conversationImport.linkedRecords[0]?.excerptNote).toBe(
      'Decision excerpt',
    );

    const detailRes = await app.inject({
      method: 'GET',
      url: `/api/v1/conversation-imports/${created.conversationImport.id}`,
      headers: { cookie: adminCookie },
    });
    expect(detailRes.statusCode).toBe(200);

    const listRes = await app.inject({
      method: 'GET',
      url: `/api/v1/conversation-imports?workspaceId=${workspaceId}`,
      headers: { cookie: adminCookie },
    });
    expect(listRes.statusCode).toBe(200);
    const listPayload = listRes.json() as {
      conversationImports: Array<{ id: string; rawContent?: string }>;
    };
    expect(listPayload.conversationImports.some((row) => row.id === created.conversationImport.id)).toBe(
      true,
    );
    expect(
      listPayload.conversationImports.find((row) => row.id === created.conversationImport.id)
        ?.rawContent,
    ).toBeUndefined();

    // Knowledge search sees the draft, not the raw import table.
    const searchRes = await app.inject({
      method: 'GET',
      url: `/api/v1/search?workspaceId=${workspaceId}&query=ship+M9`,
      headers: { cookie: adminCookie },
    });
    expect(searchRes.statusCode).toBe(200);
    const searchPayload = searchRes.json() as {
      results: Array<{ id: string; title: string }>;
    };
    expect(
      searchPayload.results.some((row) => row.id === draftPayload.knowledgeRecord.id),
    ).toBe(true);

    const archiveRes = await app.inject({
      method: 'POST',
      url: `/api/v1/conversation-imports/${created.conversationImport.id}/archive`,
      headers: { cookie: adminCookie, origin: 'http://localhost:3100' },
    });
    expect(archiveRes.statusCode).toBe(200);
    expect(
      (archiveRes.json() as { conversationImport: { archivedAt: string | null } })
        .conversationImport.archivedAt,
    ).toBeTruthy();

    void workspaceSlug;
  });
});
