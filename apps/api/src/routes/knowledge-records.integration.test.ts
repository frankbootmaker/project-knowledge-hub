import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { hashPassword } from '@project-knowledge-hub/auth';
import { loadEnv } from '@project-knowledge-hub/config';
import {
  auditEvents,
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

describe.skipIf(!hasIntegrationEnv)('Knowledge records', () => {
  let app: FastifyInstance | undefined;
  let redis: Redis | undefined;
  let closeDatabase: (() => Promise<void>) | undefined;
  let adminCookie = '';
  let readerCookie = '';
  let workspaceId = '';
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
      .values({ name: `Org ${suffix}`, slug: `org-${suffix}` })
      .returning();
    if (!org) {
      throw new Error('org missing');
    }

    const [admin] = await database.db
      .insert(users)
      .values({
        email: `admin-m3-${suffix}@example.com`,
        displayName: 'Admin',
        passwordHash: await hashPassword(password),
        isSystemAdmin: true,
        status: 'active',
      })
      .returning();
    const [reader] = await database.db
      .insert(users)
      .values({
        email: `reader-m3-${suffix}@example.com`,
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
        name: `WS ${suffix}`,
        slug: `ws-${suffix}`,
      })
      .returning();
    if (!workspace) {
      throw new Error('workspace missing');
    }
    workspaceId = workspace.id;

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
    if (app) {
      await app.close();
    }
    if (redis) {
      try {
        await redis.quit();
      } catch {
        redis.disconnect();
      }
    }
    if (closeDatabase) {
      await closeDatabase();
    }
  });

  it('returns language, translation group, and siblings on read (PRO-B-33)', async () => {
    const headers = { cookie: adminCookie, origin: 'http://localhost:3100' };
    const created = await app!.inject({
      method: 'POST',
      url: '/api/v1/knowledge-records',
      headers,
      payload: {
        workspaceId,
        title: 'Source note',
        recordType: 'note',
        language: 'en',
        contentMarkdown: '# Source',
      },
    });
    expect(created.statusCode).toBe(200);
    const source = (created.json() as { knowledgeRecord: { id: string } }).knowledgeRecord;

    const translated = await app!.inject({
      method: 'POST',
      url: `/api/v1/knowledge-records/${source.id}/translations`,
      headers,
      payload: {
        language: 'de',
        title: 'Quellnotiz',
        contentMarkdown: '# Quelle',
      },
    });
    expect(translated.statusCode).toBe(200);
    const sibling = (
      translated.json() as {
        knowledgeRecord: { id: string; language: string; translationGroupId: string };
      }
    ).knowledgeRecord;
    expect(sibling.language).toBe('de');
    expect(sibling.translationGroupId).toBeTruthy();

    const read = await app!.inject({
      method: 'GET',
      url: `/api/v1/knowledge-records/${sibling.id}`,
      headers: { cookie: adminCookie },
    });
    expect(read.statusCode).toBe(200);
    const body = read.json() as {
      knowledgeRecord: {
        language: string;
        translationGroupId: string;
        translations: Array<{ id: string; key: string | null; language: string | null }>;
      };
    };
    expect(body.knowledgeRecord.language).toBe('de');
    expect(body.knowledgeRecord.translationGroupId).toBe(sibling.translationGroupId);
    const languages = body.knowledgeRecord.translations.map((item) => item.language).sort();
    expect(languages).toEqual(['de', 'en']);
    expect(body.knowledgeRecord.translations.map((item) => item.id).sort()).toEqual(
      [source.id, sibling.id].sort(),
    );

    const sourceRead = await app!.inject({
      method: 'GET',
      url: `/api/v1/knowledge-records/${source.id}`,
      headers: { cookie: adminCookie },
    });
    const sourceBody = sourceRead.json() as {
      knowledgeRecord: { language: string | null; translationGroupId: string | null };
    };
    expect(sourceBody.knowledgeRecord.language).toBe('en');
    expect(sourceBody.knowledgeRecord.translationGroupId).toBe(sibling.translationGroupId);
  });

  it('creates a deployment guide linked to a system with safe HTML', async () => {
    const systemResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/systems',
      headers: { cookie: adminCookie, origin: 'http://localhost:3100' },
      payload: { workspaceId, name: `Deploy Target ${Date.now()}`, status: 'active' },
    });
    expect(systemResponse.statusCode).toBe(200);
    const systemBody = systemResponse.json() as { system: { id: string } };

    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/knowledge-records',
      headers: { cookie: adminCookie, origin: 'http://localhost:3100' },
      payload: {
        workspaceId,
        title: 'Production Deployment Guide',
        recordType: 'deployment-guide',
        lifecycleStatus: 'draft',
        systemId: systemBody.system.id,
        contentMarkdown:
          '# Deploy\n\n<script>alert(1)</script>\n\n```bash\necho hi\n```\n',
        tags: ['ops'],
        source: {
          sourceType: 'manual',
          sourceTitle: 'Hub draft',
          sourceProvider: 'project-knowledge-hub',
        },
      },
    });
    expect(createResponse.statusCode).toBe(200);
    const created = createResponse.json() as {
      knowledgeRecord: {
        id: string;
        recordType: string;
        systemId: string | null;
        lifecycleStatus: string;
        contentHtml?: string;
        source: { sourceTitle: string | null } | null;
      };
    };
    expect(created.knowledgeRecord.recordType).toBe('deployment-guide');
    expect(created.knowledgeRecord.systemId).toBe(systemBody.system.id);
    expect(created.knowledgeRecord.lifecycleStatus).toBe('draft');
    expect(created.knowledgeRecord.contentHtml?.toLowerCase()).not.toContain('<script');
    expect(created.knowledgeRecord.source?.sourceTitle).toBe('Hub draft');

    const verifyResponse = await app.inject({
      method: 'PATCH',
      url: `/api/v1/knowledge-records/${created.knowledgeRecord.id}`,
      headers: { cookie: adminCookie, origin: 'http://localhost:3100' },
      payload: { lifecycleStatus: 'verified' },
    });
    expect(verifyResponse.statusCode).toBe(200);
    const verified = verifyResponse.json() as {
      knowledgeRecord: {
        lifecycleStatus: string;
        verifiedAt: string | null;
        reviewedByUser: { displayName: string; email: string } | null;
        metadata: { approvedBy?: { displayName?: string; email?: string } } | null;
      };
    };
    expect(verified.knowledgeRecord.lifecycleStatus).toBe('verified');
    expect(verified.knowledgeRecord.verifiedAt).toBeTruthy();
    expect(verified.knowledgeRecord.reviewedByUser?.displayName).toBeTruthy();
    expect(verified.knowledgeRecord.metadata?.approvedBy?.displayName).toBeTruthy();
  });

  it('transliterates new slugs and renames only when slug is sent', async () => {
    const headers = { cookie: adminCookie, origin: 'http://localhost:3100' };
    const title = 'AI Lawyer – nyitott kérdések jogi átnézése';
    const legacySlug = 'ai-lawyer-nyitott-k-rd-sek-jogi-tn-z-se';

    const created = await app!.inject({
      method: 'POST',
      url: '/api/v1/knowledge-records',
      headers,
      payload: {
        workspaceId,
        title,
        recordType: 'note',
        contentMarkdown: '# Notes',
      },
    });
    expect(created.statusCode).toBe(200);
    const fresh = created.json() as {
      knowledgeRecord: { id: string; slug: string };
    };
    expect(fresh.knowledgeRecord.slug).toBe(
      'ai-lawyer-nyitott-kerdesek-jogi-atnezese',
    );

    const legacy = await app!.inject({
      method: 'POST',
      url: '/api/v1/knowledge-records',
      headers,
      payload: {
        workspaceId,
        title,
        slug: legacySlug,
        recordType: 'note',
        contentMarkdown: '# Legacy',
      },
    });
    expect(legacy.statusCode).toBe(200);
    const stored = legacy.json() as {
      knowledgeRecord: { id: string; slug: string };
    };
    expect(stored.knowledgeRecord.slug).toBe(legacySlug);

    const renamedTitle = await app!.inject({
      method: 'PATCH',
      url: `/api/v1/knowledge-records/${stored.knowledgeRecord.id}`,
      headers,
      payload: { title: `${title} (updated)` },
    });
    expect(renamedTitle.statusCode).toBe(200);
    const afterTitle = renamedTitle.json() as {
      knowledgeRecord: { slug: string; title: string };
    };
    expect(afterTitle.knowledgeRecord.title).toContain('updated');
    expect(afterTitle.knowledgeRecord.slug).toBe(legacySlug);

    const listed = await app!.inject({
      method: 'GET',
      url: `/api/v1/knowledge-records?workspaceId=${workspaceId}`,
      headers: { cookie: adminCookie },
    });
    expect(listed.statusCode).toBe(200);
    const rows = listed.json() as {
      knowledgeRecords: Array<{ id: string; slug: string }>;
    };
    expect(
      rows.knowledgeRecords.find((row) => row.id === stored.knowledgeRecord.id)?.slug,
    ).toBe(legacySlug);

    const duplicate = await app!.inject({
      method: 'POST',
      url: '/api/v1/knowledge-records',
      headers,
      payload: {
        workspaceId,
        title: 'Another',
        slug: legacySlug,
        recordType: 'note',
      },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toMatchObject({
      error: { code: 'KNOWLEDGE_RECORD_SLUG_CONFLICT' },
    });

    const invalid = await app!.inject({
      method: 'PATCH',
      url: `/api/v1/knowledge-records/${fresh.knowledgeRecord.id}`,
      headers,
      payload: { slug: 'Not A Slug' },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Slug must be lowercase a-z, digits, and hyphens',
      },
    });

    const renamed = await app!.inject({
      method: 'PATCH',
      url: `/api/v1/knowledge-records/${fresh.knowledgeRecord.id}`,
      headers,
      payload: { slug: 'ai-lawyer-notes', changeMessage: 'Rename slug' },
    });
    expect(renamed.statusCode).toBe(200);
    expect(
      (renamed.json() as { knowledgeRecord: { slug: string } }).knowledgeRecord.slug,
    ).toBe('ai-lawyer-notes');

    const conflict = await app!.inject({
      method: 'PATCH',
      url: `/api/v1/knowledge-records/${stored.knowledgeRecord.id}`,
      headers,
      payload: { slug: 'ai-lawyer-notes' },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({
      error: {
        code: 'KNOWLEDGE_RECORD_SLUG_CONFLICT',
        message: 'A knowledge record with this slug already exists in the workspace',
      },
    });

    const audits = await app!.database.db
      .select({ metadata: auditEvents.metadataJson })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.entityId, fresh.knowledgeRecord.id),
          eq(auditEvents.action, 'knowledge_record.update'),
        ),
      );
    expect(
      audits.some((row) => {
        const meta = row.metadata as { previousSlug?: string; slug?: string } | null;
        return (
          meta?.previousSlug === 'ai-lawyer-nyitott-kerdesek-jogi-atnezese' &&
          meta.slug === 'ai-lawyer-notes'
        );
      }),
    ).toBe(true);
  });

  it('pages and searches the catalogue without returning every record', async () => {
    const headers = { cookie: adminCookie, origin: 'http://localhost:3100' };
    const marker = `picker-${randomUUID().slice(0, 8)}`;
    const created = await app!.inject({
      method: 'POST',
      url: '/api/v1/knowledge-records',
      headers,
      payload: {
        workspaceId,
        title: `${marker} alpha`,
        recordType: 'note',
        contentMarkdown: '# Alpha',
      },
    });
    expect(created.statusCode).toBe(200);
    const createdId = (created.json() as { knowledgeRecord: { id: string } }).knowledgeRecord.id;
    const other = await app!.inject({
      method: 'POST',
      url: '/api/v1/knowledge-records',
      headers,
      payload: {
        workspaceId,
        title: `${marker} beta`,
        recordType: 'overview',
        contentMarkdown: '# Beta',
      },
    });
    expect(other.statusCode).toBe(200);

    const page = await app!.inject({
      method: 'GET',
      url: `/api/v1/knowledge-records?workspaceId=${workspaceId}&q=${encodeURIComponent(marker)}&limit=1&offset=0&recordType=note&workspaceLevel=true`,
      headers: { cookie: adminCookie },
    });
    expect(page.statusCode).toBe(200);
    const body = page.json() as {
      total: number;
      knowledgeRecords: Array<{ id: string; title: string; contentMarkdown?: string }>;
    };
    expect(body.total).toBe(1);
    expect(body.knowledgeRecords).toHaveLength(1);
    expect(body.knowledgeRecords[0]?.id).toBe(createdId);
    expect(body.knowledgeRecords[0]?.contentMarkdown).toBeUndefined();

    const excluded = await app!.inject({
      method: 'GET',
      url: `/api/v1/knowledge-records?workspaceId=${workspaceId}&q=${encodeURIComponent(marker)}&limit=5&excludeIds=${createdId}`,
      headers: { cookie: adminCookie },
    });
    expect(excluded.statusCode).toBe(200);
    const excludedBody = excluded.json() as {
      total: number;
      knowledgeRecords: Array<{ id: string }>;
    };
    expect(excludedBody.total).toBe(1);
    expect(excludedBody.knowledgeRecords.map((row) => row.id)).not.toContain(createdId);
  });

  it('blocks reader mutations and allows reader views', async () => {
    const readerCreate = await app.inject({
      method: 'POST',
      url: '/api/v1/knowledge-records',
      headers: { cookie: readerCookie, origin: 'http://localhost:3100' },
      payload: {
        workspaceId,
        title: 'Reader Record',
        recordType: 'overview',
      },
    });
    expect(readerCreate.statusCode).toBe(403);

    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/knowledge-records?workspaceId=${workspaceId}`,
      headers: { cookie: readerCookie },
    });
    expect(list.statusCode).toBe(200);
  });
});
