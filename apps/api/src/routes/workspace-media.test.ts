import { describe, expect, it, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import type { Database } from '@project-knowledge-hub/database';

const pngBuffer = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52,
]);

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn().mockResolvedValue(pngBuffer),
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  unlink: vi.fn(),
}));

describe('workspace-media routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET /api/v1/media/:mediaId sets X-Content-Type-Options: nosniff', async () => {
    const { registerWorkspaceMediaRoutes } = await import('./workspace-media.js');
    
    const app = Fastify();

    const mediaId = randomUUID();
    const workspaceId = randomUUID();

    const mockDatabase = {
      db: {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([
          {
            id: mediaId,
            workspaceId,
            contentType: 'image/png',
            byteSize: 16,
            knowledgeRecordId: null,
            originalFilename: 'test.png',
            altText: null,
            createdBy: null,
            createdAt: new Date(),
            archivedAt: null,
          },
        ]),
      },
    } as unknown as Database;

    app.decorate('database', mockDatabase);
    app.decorate('env', {
      MEDIA_UPLOAD_DIR: '/tmp/media',
      MEDIA_MAX_BYTES: 10 * 1024 * 1024,
    });
    app.decorate('getBlobStore', async () => ({
      store: { provider: 'disabled', get: vi.fn(), put: vi.fn(), delete: vi.fn() },
    }));

    app.addHook('preHandler', async (request) => {
      request.principal = {
        type: 'user',
        userId: randomUUID(),
        workspaceIds: [workspaceId],
        isSystemAdmin: true,
      };
    });

    await registerWorkspaceMediaRoutes(app);
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/media/${mediaId}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('image/png');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['cache-control']).toContain('private');
    expect(response.headers['content-disposition']).toContain('test.png');

    await app.close();
  });
});
