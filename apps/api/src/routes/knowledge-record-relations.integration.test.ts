import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, or } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { hashPassword } from '@project-knowledge-hub/auth';
import { loadEnv } from '@project-knowledge-hub/config';
import {
  auditEvents,
  createDatabase,
  knowledgeRecordRelations,
  memberships,
  organizations,
  projects,
  users,
  workspaces,
  type Database,
} from '@project-knowledge-hub/database';
import { allocateGlobalIntegrationKeyPrefix } from '../integration-test/unique-key-prefix.js';
import { buildApp } from '../app.js';
import type { FastifyInstance } from 'fastify';

const hasIntegrationEnv =
  Boolean(process.env.DATABASE_URL) && Boolean(process.env.REDIS_URL);

const ORIGIN = 'http://localhost:3100';

type ErrorBody = { error: { code: string; message: string } };

type RecordBody = {
  knowledgeRecord: { id: string; humanKey: string | null; slug: string };
};

type RelationsBody = {
  relations: {
    outbound: Array<{ relationType: string; record: { id: string } }>;
    inbound: Array<{ relationType: string; record: { id: string } }>;
  };
  lifecycleSuccessor: { id: string } | null;
  lifecyclePredecessor: { id: string } | null;
};

function testEnv() {
  return loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    APP_ENV: 'test',
    LOG_LEVEL: 'silent',
    SESSION_SECRET:
      process.env.SESSION_SECRET ?? 'test-session-secret-at-least-32-chars',
    WEB_URL: process.env.WEB_URL ?? ORIGIN,
  });
}

describe.skipIf(!hasIntegrationEnv)('Knowledge record relations', () => {
  let app: FastifyInstance | undefined;
  let redis: Redis | undefined;
  let database: Database | undefined;
  let adminCookie = '';
  let readerCookie = '';
  let workspaceId = '';
  const password = 'test-password-123';

  function headers(cookie: string) {
    return { cookie, origin: ORIGIN };
  }

  beforeAll(async () => {
    const env = testEnv();
    database = createDatabase(env.DATABASE_URL);
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
    if (!org) throw new Error('org missing');

    const [admin] = await database.db
      .insert(users)
      .values({
        email: `admin-rel-${suffix}@example.com`,
        displayName: 'Admin',
        passwordHash: await hashPassword(password),
        isSystemAdmin: true,
        status: 'active',
      })
      .returning();
    const [reader] = await database.db
      .insert(users)
      .values({
        email: `reader-rel-${suffix}@example.com`,
        displayName: 'Reader',
        passwordHash: await hashPassword(password),
        isSystemAdmin: false,
        status: 'active',
      })
      .returning();
    if (!admin || !reader) throw new Error('users missing');

    const [workspace] = await database.db
      .insert(workspaces)
      .values({
        organizationId: org.id,
        name: `WS ${suffix}`,
        slug: `ws-${suffix}`,
      })
      .returning();
    if (!workspace) throw new Error('workspace missing');
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
    adminCookie = `${env.SESSION_COOKIE_NAME}=${adminLogin.cookies.find((cookie) => cookie.name === env.SESSION_COOKIE_NAME)?.value}`;

    const readerLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: reader.email, password },
    });
    readerCookie = `${env.SESSION_COOKIE_NAME}=${readerLogin.cookies.find((cookie) => cookie.name === env.SESSION_COOKIE_NAME)?.value}`;
  });

  afterAll(async () => {
    if (app) await app.close();
    if (redis) {
      try {
        await redis.quit();
      } catch {
        redis.disconnect();
      }
    }
    if (database) await database.close();
  });

  async function createProject(name: string) {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const keyPrefix = await allocateGlobalIntegrationKeyPrefix(database!);
      const response = await app!.inject({
        method: 'POST',
        url: '/api/v1/projects',
        headers: headers(adminCookie),
        payload: { workspaceId, name, keyPrefix },
      });
      if (response.statusCode === 409) {
        continue;
      }
      expect(response.statusCode).toBe(200);
      return (response.json() as { project: { id: string; keyPrefix: string | null } }).project;
    }
    throw new Error('createProject failed after keyPrefix retries');
  }

  async function createRecord(input: {
    title: string;
    projectId?: string | null;
    workspace?: string;
  }) {
    const response = await app!.inject({
      method: 'POST',
      url: '/api/v1/knowledge-records',
      headers: headers(adminCookie),
      payload: {
        workspaceId: input.workspace ?? workspaceId,
        title: input.title,
        recordType: 'architecture',
        projectId: input.projectId ?? undefined,
        contentMarkdown: `# ${input.title}`,
      },
    });
    expect(response.statusCode, response.body).toBe(200);
    return (response.json() as RecordBody).knowledgeRecord;
  }

  async function putRelations(
    recordId: string,
    links: Array<{ targetRecordId: string; relationType: string }>,
    cookie = adminCookie,
  ) {
    return app!.inject({
      method: 'PUT',
      url: `/api/v1/knowledge-records/${recordId}/relations`,
      headers: headers(cookie),
      payload: { links },
    });
  }

  async function getRelations(recordId: string, cookie = adminCookie) {
    return app!.inject({
      method: 'GET',
      url: `/api/v1/knowledge-records/${recordId}/relations`,
      headers: { cookie },
    });
  }

  it('stores one symmetric edge and labels the inverse on the other record', async () => {
    const project = await createProject('Symmetry');
    const left = await createRecord({ title: 'Arch left', projectId: project.id });
    const right = await createRecord({ title: 'Arch right', projectId: project.id });
    expect(left.humanKey).toBeTruthy();

    const created = await putRelations(right.humanKey ?? right.id, [
      { targetRecordId: left.humanKey ?? left.id, relationType: 'relates_to' },
    ]);
    expect(created.statusCode, created.body).toBe(200);

    const fromLeft = (await getRelations(left.id)).json() as RelationsBody;
    const fromRight = (await getRelations(right.id)).json() as RelationsBody;
    expect(fromLeft.relations.outbound).toEqual([
      expect.objectContaining({
        relationType: 'relates_to',
        record: expect.objectContaining({ id: right.id }),
      }),
    ]);
    expect(fromRight.relations.outbound).toEqual([
      expect.objectContaining({
        relationType: 'relates_to',
        record: expect.objectContaining({ id: left.id }),
      }),
    ]);
    expect(fromLeft.relations.inbound).toEqual([]);
    expect(fromRight.relations.inbound).toEqual([]);

    const rows = await database!.db
      .select()
      .from(knowledgeRecordRelations)
      .where(
        or(
          eq(knowledgeRecordRelations.fromKnowledgeRecordId, left.id),
          eq(knowledgeRecordRelations.toKnowledgeRecordId, left.id),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.relationType).toBe('relates_to');
    expect(rows[0]?.fromKnowledgeRecordId < (rows[0]?.toKnowledgeRecordId ?? '')).toBe(
      true,
    );
  });

  it('PRO-B-27 removes a symmetric relation from either uuid order', async () => {
    const project = await createProject('Either side');
    const first = await createRecord({ title: 'First note', projectId: project.id });
    const second = await createRecord({ title: 'Second note', projectId: project.id });
    const [lower, higher] = [first, second].sort((left, right) =>
      left.id.localeCompare(right.id),
    );
    if (!lower || !higher) throw new Error('records missing');

    const relates = await putRelations(higher.id, [
      { targetRecordId: lower.id, relationType: 'relates_to' },
      { targetRecordId: lower.id, relationType: 'derived_from' },
    ]);
    expect(relates.statusCode, relates.body).toBe(200);
    const created = relates.json() as RelationsBody;
    expect(created.relations.outbound.map((edge) => edge.relationType).sort()).toEqual([
      'derived_from',
      'relates_to',
    ]);
    expect(created.relations.inbound).toEqual([]);

    const clearedHigher = await putRelations(higher.id, []);
    expect(clearedHigher.statusCode, clearedHigher.body).toBe(200);
    const afterHigher = clearedHigher.json() as RelationsBody;
    expect(afterHigher.relations.outbound).toEqual([]);
    expect(afterHigher.relations.inbound).toEqual([]);
    const fromLower = (await getRelations(lower.id)).json() as RelationsBody;
    expect(fromLower.relations.outbound).toEqual([]);
    expect(fromLower.relations.inbound).toEqual([]);

    const contradicts = await putRelations(higher.id, [
      { targetRecordId: lower.id, relationType: 'contradicts' },
    ]);
    expect(contradicts.statusCode, contradicts.body).toBe(200);
    expect(
      (contradicts.json() as RelationsBody).relations.outbound.some(
        (edge) => edge.relationType === 'contradicts' && edge.record.id === lower.id,
      ),
    ).toBe(true);
    const clearedAgain = await putRelations(higher.id, []);
    expect(clearedAgain.statusCode).toBe(200);
    expect((clearedAgain.json() as RelationsBody).relations.outbound).toEqual([]);

    const fromLow = await putRelations(lower.id, [
      { targetRecordId: higher.id, relationType: 'relates_to' },
    ]);
    expect(fromLow.statusCode, fromLow.body).toBe(200);
    expect(
      (fromLow.json() as RelationsBody).relations.outbound.some(
        (edge) => edge.relationType === 'relates_to',
      ),
    ).toBe(true);
    const clearedLow = await putRelations(lower.id, []);
    expect(clearedLow.statusCode).toBe(200);
    expect((await getRelations(higher.id)).json()).toMatchObject({
      relations: { outbound: [], inbound: [] },
    });
  });

  it('keeps inbound directed edges when the target replaces its own links', async () => {
    const project = await createProject('Directed');
    const upstream = await createRecord({ title: 'Upstream', projectId: project.id });
    const downstream = await createRecord({ title: 'Downstream', projectId: project.id });
    const set = await putRelations(downstream.id, [
      { targetRecordId: upstream.id, relationType: 'depends_on' },
    ]);
    expect(set.statusCode, set.body).toBe(200);
    const inbound = (await getRelations(upstream.id)).json() as RelationsBody;
    expect(inbound.relations.inbound).toEqual([
      expect.objectContaining({
        relationType: 'required_by',
        record: expect.objectContaining({ id: downstream.id }),
      }),
    ]);

    const cleared = await putRelations(upstream.id, []);
    expect(cleared.statusCode).toBe(200);
    const still = (await getRelations(upstream.id)).json() as RelationsBody;
    expect(still.relations.inbound.map((edge) => edge.record.id)).toContain(downstream.id);
  });

  it('rejects cycles, self links, and cross-scope targets', async () => {
    const project = await createProject('Cycles');
    const other = await createProject('Other scope');
    const a = await createRecord({ title: 'A', projectId: project.id });
    const b = await createRecord({ title: 'B', projectId: project.id });
    const c = await createRecord({ title: 'C', projectId: project.id });
    const elsewhere = await createRecord({ title: 'Elsewhere', projectId: other.id });
    const workspaceOnly = await createRecord({ title: 'Workspace only' });

    expect((await putRelations(a.id, [
      { targetRecordId: b.id, relationType: 'depends_on' },
    ])).statusCode).toBe(200);
    expect((await putRelations(b.id, [
      { targetRecordId: c.id, relationType: 'depends_on' },
    ])).statusCode).toBe(200);
    const cycle = await putRelations(c.id, [
      { targetRecordId: a.id, relationType: 'depends_on' },
    ]);
    expect(cycle.statusCode).toBe(400);
    expect((cycle.json() as ErrorBody).error.code).toBe('RELATION_CYCLE');

    expect((await putRelations(a.id, [
      { targetRecordId: b.id, relationType: 'refines' },
    ])).statusCode).toBe(200);
    const refinesCycle = await putRelations(b.id, [
      { targetRecordId: a.id, relationType: 'refines' },
    ]);
    expect(refinesCycle.statusCode).toBe(400);
    expect((refinesCycle.json() as ErrorBody).error.code).toBe('RELATION_CYCLE');

    const mutual = await putRelations(a.id, [
      { targetRecordId: b.id, relationType: 'derived_from' },
    ]);
    expect(mutual.statusCode).toBe(200);
    const back = await putRelations(b.id, [
      { targetRecordId: a.id, relationType: 'derived_from' },
    ]);
    expect(back.statusCode, back.body).toBe(200);

    const self = await putRelations(a.id, [
      { targetRecordId: a.id, relationType: 'contradicts' },
    ]);
    expect(self.statusCode).toBe(400);
    expect((self.json() as ErrorBody).error.code).toBe('RELATION_SELF_LINK');

    const crossProject = await putRelations(a.id, [
      { targetRecordId: elsewhere.id, relationType: 'relates_to' },
    ]);
    expect(crossProject.statusCode).toBe(400);
    expect((crossProject.json() as ErrorBody).error.code).toBe(
      'RELATION_PROJECT_MISMATCH',
    );

    const crossScope = await putRelations(a.id, [
      { targetRecordId: workspaceOnly.id, relationType: 'relates_to' },
    ]);
    expect(crossScope.statusCode).toBe(400);
    expect((crossScope.json() as ErrorBody).error.code).toBe(
      'RELATION_PROJECT_MISMATCH',
    );

    const workspacePair = await createRecord({ title: 'Workspace peer' });
    const sameScope = await putRelations(workspaceOnly.id, [
      { targetRecordId: workspacePair.id, relationType: 'contradicts' },
    ]);
    expect(sameScope.statusCode, sameScope.body).toBe(200);
  });

  it('rejects archived endpoints, reader writes, and more than 200 links', async () => {
    const project = await createProject('Archive');
    const live = await createRecord({ title: 'Live', projectId: project.id });
    const archived = await createRecord({ title: 'Archived', projectId: project.id });
    const archive = await app!.inject({
      method: 'DELETE',
      url: `/api/v1/knowledge-records/${archived.id}`,
      headers: headers(adminCookie),
    });
    expect(archive.statusCode).toBe(200);

    const toArchived = await putRelations(live.id, [
      { targetRecordId: archived.id, relationType: 'refines' },
    ]);
    expect(toArchived.statusCode).toBe(400);
    expect((toArchived.json() as ErrorBody).error.code).toBe('RELATION_ARCHIVED');

    const fromArchived = await putRelations(archived.id, [
      { targetRecordId: live.id, relationType: 'relates_to' },
    ]);
    expect(fromArchived.statusCode).toBe(400);
    expect((fromArchived.json() as ErrorBody).error.code).toBe('RELATION_ARCHIVED');

    const reader = await putRelations(live.id, [], readerCookie);
    expect(reader.statusCode).toBe(403);
    const readerRead = await getRelations(live.id, readerCookie);
    expect(readerRead.statusCode).toBe(200);

    const tooMany = await putRelations(
      live.id,
      Array.from({ length: 201 }, () => ({
        targetRecordId: randomUUID(),
        relationType: 'relates_to',
      })),
    );
    expect(tooMany.statusCode).toBe(400);
  });

  it('cascades relation rows when a record is purged and writes an audit event', async () => {
    const project = await createProject('Cascade');
    const keep = await createRecord({ title: 'Keep', projectId: project.id });
    const drop = await createRecord({ title: 'Drop', projectId: project.id });
    const set = await putRelations(keep.id, [
      { targetRecordId: drop.id, relationType: 'derived_from' },
    ]);
    expect(set.statusCode).toBe(200);

    const audits = await database!.db
      .select({ action: auditEvents.action, metadata: auditEvents.metadataJson })
      .from(auditEvents)
      .where(eq(auditEvents.entityId, keep.id));
    expect(audits.some((row) => row.action === 'knowledge.record_relations_set')).toBe(
      true,
    );

    const purged = await app!.inject({
      method: 'POST',
      url: `/api/v1/knowledge-records/${drop.id}/purge`,
      headers: headers(adminCookie),
      payload: { confirmDestroy: true },
    });
    expect(purged.statusCode).toBe(204);

    const remaining = await database!.db
      .select({ id: knowledgeRecordRelations.id })
      .from(knowledgeRecordRelations)
      .where(
        or(
          eq(knowledgeRecordRelations.fromKnowledgeRecordId, drop.id),
          eq(knowledgeRecordRelations.toKnowledgeRecordId, drop.id),
        ),
      );
    expect(remaining).toHaveLength(0);
    const after = (await getRelations(keep.id)).json() as RelationsBody;
    expect(after.relations.outbound).toEqual([]);
    expect(after.relations.inbound).toEqual([]);
  });

  it('adds compact recordRelations only when the detail query asks for them', async () => {
    const record = await createRecord({ title: 'Compact' });
    const plain = await app!.inject({
      method: 'GET',
      url: `/api/v1/knowledge-records/${record.id}`,
      headers: { cookie: adminCookie },
    });
    expect(plain.statusCode).toBe(200);
    expect(plain.json()).not.toHaveProperty('knowledgeRecord.recordRelations');
    const withRelations = await app!.inject({
      method: 'GET',
      url: `/api/v1/knowledge-records/${record.id}?includeRecordRelations=true`,
      headers: { cookie: adminCookie },
    });
    const body = withRelations.json() as {
      knowledgeRecord: {
        recordRelations: { outboundCount: number; inboundCount: number; cap: number };
      };
    };
    expect(body.knowledgeRecord.recordRelations).toMatchObject({
      outboundCount: 0,
      inboundCount: 0,
      cap: 20,
      truncated: false,
      items: [],
    });
  });

  it('blocks relation writes on an archived project', async () => {
    const project = await createProject('Frozen');
    const left = await createRecord({ title: 'Frozen left', projectId: project.id });
    const right = await createRecord({ title: 'Frozen right', projectId: project.id });
    await database!.db
      .update(projects)
      .set({ archivedAt: new Date() })
      .where(eq(projects.id, project.id));
    const blocked = await putRelations(left.id, [
      { targetRecordId: right.id, relationType: 'relates_to' },
    ]);
    expect(blocked.statusCode).toBe(409);
    expect((blocked.json() as ErrorBody).error.code).toBe('PROJECT_ARCHIVED');
  });
});
