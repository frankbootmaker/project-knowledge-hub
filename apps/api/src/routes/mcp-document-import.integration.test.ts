import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
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
  workspaceMedia,
  workspaces,
} from '@project-knowledge-hub/database';
import { DEFAULT_MCP_SCOPES } from '@project-knowledge-hub/mcp';
import { buildApp } from '../app.js';
import { writeMediaBytes } from '../lib/workspace-media.js';
import type { FastifyInstance } from 'fastify';

const hasIntegrationEnv =
  Boolean(process.env.DATABASE_URL) && Boolean(process.env.REDIS_URL);

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const importDir = mkdtempSync(path.join(tmpdir(), 'kh-doc-import-'));

function testEnv() {
  return loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    APP_ENV: 'test',
    LOG_LEVEL: 'silent',
    SESSION_SECRET:
      process.env.SESSION_SECRET ?? 'test-session-secret-at-least-32-chars',
    WEB_URL: process.env.WEB_URL ?? 'http://localhost:3100',
    MARKITDOWN_URL: 'http://127.0.0.1:9',
    DOCUMENT_IMPORT_MAX_BYTES: '128',
    DOCUMENT_IMPORT_OCR_ENGINE: 'none',
    DOCUMENT_IMPORT_DIR: importDir,
  });
}

async function mcpCall(
  app: FastifyInstance,
  token: string,
  id: number,
  method: string,
  params: Record<string, unknown>,
) {
  return app.inject({
    method: 'POST',
    url: '/mcp',
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
    },
    payload: {
      jsonrpc: '2.0',
      id,
      method,
      params,
    },
  });
}

function toolPayload<T>(response: { json: () => unknown }): {
  isError: boolean;
  text: string;
  data: T;
} {
  const body = response.json() as {
    result?: { isError?: boolean; content?: Array<{ text?: string }> };
  };
  const text = body.result?.content?.[0]?.text ?? '';
  let data = {} as T;
  try {
    data = JSON.parse(text) as T;
  } catch {
    data = {} as T;
  }
  return { isError: Boolean(body.result?.isError), text, data };
}

type ImportedRecord = {
  knowledgeRecord?: {
    id?: string;
    humanKey?: string | null;
    key?: string | null;
    title?: string;
    recordType?: string;
    language?: string;
    lifecycleStatus?: string;
    sourceOfTruthMode?: string;
    contentMarkdown?: string;
  };
};

describe.skipIf(!hasIntegrationEnv)('MCP document import', () => {
  let app: FastifyInstance | undefined;
  let redis: Redis | undefined;
  let closeDatabase: (() => Promise<void>) | undefined;
  let writeToken = '';
  let readerToken = '';
  let workspaceId = '';
  let projectId = '';
  let keyPrefix = '';
  const realFetch = globalThis.fetch;
  let callId = 1;

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
    if (!org) throw new Error('org missing');

    const [admin] = await database.db
      .insert(users)
      .values({
        email: `admin-doc-${suffix}@example.com`,
        displayName: 'Admin',
        passwordHash: await hashPassword('test-password-123'),
        isSystemAdmin: true,
        status: 'active',
      })
      .returning();
    if (!admin) throw new Error('admin missing');

    const [reader] = await database.db
      .insert(users)
      .values({
        email: `reader-doc-${suffix}@example.com`,
        displayName: 'Reader',
        passwordHash: await hashPassword('test-password-123'),
        isSystemAdmin: false,
        status: 'active',
      })
      .returning();
    if (!reader) throw new Error('reader missing');

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
      workspaceId,
      role: 'reader',
    });

    app = await buildApp({ env, database, redis });
    await app.ready();

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      if (url.includes('/convert')) {
        let filename = 'upload';
        if (init?.body instanceof FormData) {
          const file = init.body.get('file');
          if (file instanceof File && file.name) filename = file.name;
        }
        return new Response(
          JSON.stringify({
            markdown: `# ${filename}\n\nConverted body`,
            titleHint: filename,
            images: [],
            warnings: [],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return realFetch(input, init);
    }) as typeof fetch;

    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: admin.email, password: 'test-password-123' },
    });
    const cookie = `${env.SESSION_COOKIE_NAME}=${
      login.cookies.find((c) => c.name === env.SESSION_COOKIE_NAME)?.value
    }`;

    const writeClient = await app.inject({
      method: 'POST',
      url: '/api/v1/api-clients',
      headers: { cookie, origin: 'http://localhost:3100' },
      payload: {
        organizationId: org.id,
        name: 'MCP document import',
        scopes: [...DEFAULT_MCP_SCOPES, 'knowledge:write'],
        allowedWorkspaceIds: [workspaceId],
        actingUserId: admin.id,
      },
    });
    expect(writeClient.statusCode).toBe(200);
    writeToken = (writeClient.json() as { token: string }).token;

    const readerClient = await app.inject({
      method: 'POST',
      url: '/api/v1/api-clients',
      headers: { cookie, origin: 'http://localhost:3100' },
      payload: {
        organizationId: org.id,
        name: 'MCP document reader',
        scopes: [...DEFAULT_MCP_SCOPES, 'knowledge:write'],
        allowedWorkspaceIds: [workspaceId],
        actingUserId: reader.id,
      },
    });
    expect(readerClient.statusCode).toBe(200);
    readerToken = (readerClient.json() as { token: string }).token;

    const project = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { cookie, origin: 'http://localhost:3100' },
      payload: { workspaceId, name: `Docs ${suffix}`, status: 'active' },
    });
    expect(project.statusCode).toBe(200);
    const created = project.json() as { project: { id: string; keyPrefix: string } };
    projectId = created.project.id;
    keyPrefix = created.project.keyPrefix;
  });

  afterAll(async () => {
    globalThis.fetch = realFetch;
    await new Promise((resolve) => {
      setTimeout(resolve, 600);
    });
    if (app) await app.close();
    if (redis) {
      try {
        await redis.quit();
      } catch {
        redis.disconnect();
      }
    }
    if (closeDatabase) await closeDatabase();
  });

  async function importFile(
    token: string,
    arguments_: Record<string, unknown>,
  ) {
    const response = await mcpCall(app!, token, callId, 'tools/call', {
      name: 'import_document_knowledge_record',
      arguments: {
        workspaceId,
        projectId,
        ...arguments_,
      },
    });
    callId += 1;
    expect(response.statusCode).toBe(200);
    return toolPayload<ImportedRecord>(response);
  }

  it('lists the import tool and creates a record from a PDF', async () => {
    const listed = await mcpCall(app!, writeToken, callId, 'tools/list', {});
    callId += 1;
    const names = (
      listed.json() as { result?: { tools?: Array<{ name: string }> } }
    ).result?.tools?.map((tool) => tool.name);
    expect(names).toContain('import_document_knowledge_record');

    const result = await importFile(writeToken, {
      filename: 'brief.pdf',
      contentType: 'application/pdf',
      contentBase64: Buffer.from('hello pdf').toString('base64'),
      title: 'Brief',
      recordType: 'note',
      language: 'en',
    });

    expect(result.isError).toBe(false);
    const record = result.data.knowledgeRecord;
    expect(record?.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(record?.humanKey).toBe(`${keyPrefix}-NOTE-1`);
    expect(record?.key).toBe(record?.humanKey);
    expect(record?.title).toBe('Brief');
    expect(record?.recordType).toBe('note');
    expect(record?.language).toBe('en');
    expect(record?.lifecycleStatus).toBe('draft');
    expect(record?.sourceOfTruthMode).toBe('imported_snapshot');
    expect(record?.contentMarkdown).toContain('brief.pdf');
    expect(record?.contentMarkdown).toContain('Converted body');
  });

  it('creates a record from a DOCX', async () => {
    const result = await importFile(writeToken, {
      filename: 'spec.docx',
      contentType: DOCX_MIME,
      contentBase64: Buffer.from('hello docx').toString('base64'),
      title: 'Imported brief',
      recordType: 'decision',
      language: 'de',
    });

    expect(result.isError).toBe(false);
    const record = result.data.knowledgeRecord;
    expect(record?.id).toBeTruthy();
    expect(record?.humanKey).toBe(`${keyPrefix}-DEC-1`);
    expect(record?.key).toBe(record?.humanKey);
    expect(record?.recordType).toBe('decision');
    expect(record?.language).toBe('de');
    expect(record?.contentMarkdown).toContain('spec.docx');
    expect(record?.contentMarkdown).toContain('Converted body');
  });

  it('imports a PDF already stored as workspace media', async () => {
    const mediaId = randomUUID();
    const bytes = Buffer.from('stored pdf');
    await writeMediaBytes(app!.env.MEDIA_UPLOAD_DIR, workspaceId, mediaId, bytes);
    await app!.database.db.insert(workspaceMedia).values({
      id: mediaId,
      workspaceId,
      contentType: 'application/pdf',
      byteSize: bytes.byteLength,
      originalFilename: 'stored.pdf',
    });

    const result = await importFile(writeToken, { mediaId, recordType: 'note' });
    expect(result.isError).toBe(false);
    expect(result.data.knowledgeRecord?.contentMarkdown).toContain('stored.pdf');
    expect(result.data.knowledgeRecord?.humanKey).toBe(`${keyPrefix}-NOTE-2`);
  });

  it('rejects an unsupported file type', async () => {
    const result = await importFile(writeToken, {
      filename: 'notes.exe',
      contentType: 'application/x-msdownload',
      contentBase64: Buffer.from('not a document').toString('base64'),
    });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('DOCUMENT_IMPORT_TYPE_UNSUPPORTED');
    expect(result.text).toContain('Unsupported document type');
  });

  it('rejects an oversized file', async () => {
    const result = await importFile(writeToken, {
      filename: 'large.pdf',
      contentType: 'application/pdf',
      contentBase64: Buffer.alloc(200, 1).toString('base64'),
    });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('DOCUMENT_IMPORT_TOO_LARGE');
    expect(result.text).toContain('128');
  });

  it('rejects a reader who is not a workspace maintainer', async () => {
    const result = await importFile(readerToken, {
      filename: 'secret.pdf',
      contentType: 'application/pdf',
      contentBase64: Buffer.from('nope').toString('base64'),
    });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('FORBIDDEN');
    expect(result.text).toContain('Workspace maintainer privileges are required');
  });
});
