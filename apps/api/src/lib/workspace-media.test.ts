import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Database } from '@project-knowledge-hub/database';
import type { BlobStore } from '@project-knowledge-hub/blob-store';
import { createWorkspaceMedia } from './workspace-media.js';

describe('workspace-media', () => {
  const mockDatabase = {
    db: {
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      returning: vi.fn(),
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    },
  } as unknown as Database;

  const mockBlobStore: BlobStore = {
    provider: 'disabled',
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  };

  const workspaceId = randomUUID();
  const uploadDir = '/tmp/test-media';
  const maxBytes = 10 * 1024 * 1024;

  beforeAll(() => {
    vi.mock('node:fs/promises', () => ({
      mkdir: vi.fn().mockResolvedValue(undefined),
      writeFile: vi.fn().mockResolvedValue(undefined),
      readFile: vi.fn().mockResolvedValue(Buffer.from('test')),
      unlink: vi.fn().mockResolvedValue(undefined),
    }));
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  describe('createWorkspaceMedia validation', () => {
    it('accepts valid PNG bytes with image/png', async () => {
      const pngBuffer = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
        0x49, 0x48, 0x44, 0x52,
      ]);

      mockDatabase.db.returning = vi.fn().mockResolvedValue([
        {
          id: randomUUID(),
          workspaceId,
          contentType: 'image/png',
          byteSize: pngBuffer.length,
          knowledgeRecordId: null,
          originalFilename: null,
          altText: null,
          createdBy: null,
          createdAt: new Date(),
          archivedAt: null,
        },
      ]);

      await expect(
        createWorkspaceMedia(mockDatabase, {
          workspaceId,
          contentType: 'image/png',
          buffer: pngBuffer,
          uploadDir,
          maxBytes,
          blobStore: mockBlobStore,
        }),
      ).resolves.toBeDefined();
    });

    it('accepts valid JPEG bytes with image/jpeg', async () => {
      const jpegBuffer = Buffer.from([
        0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
        0x01, 0x01, 0x00, 0x48,
      ]);

      mockDatabase.db.returning = vi.fn().mockResolvedValue([
        {
          id: randomUUID(),
          workspaceId,
          contentType: 'image/jpeg',
          byteSize: jpegBuffer.length,
          knowledgeRecordId: null,
          originalFilename: null,
          altText: null,
          createdBy: null,
          createdAt: new Date(),
          archivedAt: null,
        },
      ]);

      await expect(
        createWorkspaceMedia(mockDatabase, {
          workspaceId,
          contentType: 'image/jpeg',
          buffer: jpegBuffer,
          uploadDir,
          maxBytes,
          blobStore: mockBlobStore,
        }),
      ).resolves.toBeDefined();
    });

    it('accepts valid GIF bytes with image/gif', async () => {
      const gifBuffer = Buffer.from([
        0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x10, 0x00, 0x10, 0x00, 0xf0, 0x00,
        0x00, 0x00, 0x00, 0x00,
      ]);

      mockDatabase.db.returning = vi.fn().mockResolvedValue([
        {
          id: randomUUID(),
          workspaceId,
          contentType: 'image/gif',
          byteSize: gifBuffer.length,
          knowledgeRecordId: null,
          originalFilename: null,
          altText: null,
          createdBy: null,
          createdAt: new Date(),
          archivedAt: null,
        },
      ]);

      await expect(
        createWorkspaceMedia(mockDatabase, {
          workspaceId,
          contentType: 'image/gif',
          buffer: gifBuffer,
          uploadDir,
          maxBytes,
          blobStore: mockBlobStore,
        }),
      ).resolves.toBeDefined();
    });

    it('accepts valid WebP bytes with image/webp', async () => {
      const webpBuffer = Buffer.from([
        0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
        0x56, 0x50, 0x38, 0x4c,
      ]);

      mockDatabase.db.returning = vi.fn().mockResolvedValue([
        {
          id: randomUUID(),
          workspaceId,
          contentType: 'image/webp',
          byteSize: webpBuffer.length,
          knowledgeRecordId: null,
          originalFilename: null,
          altText: null,
          createdBy: null,
          createdAt: new Date(),
          archivedAt: null,
        },
      ]);

      await expect(
        createWorkspaceMedia(mockDatabase, {
          workspaceId,
          contentType: 'image/webp',
          buffer: webpBuffer,
          uploadDir,
          maxBytes,
          blobStore: mockBlobStore,
        }),
      ).resolves.toBeDefined();
    });

    it('rejects plain text declared as PNG (single-shot upload)', async () => {
      const textBuffer = Buffer.from('This is plain text, not an image', 'utf8');

      await expect(
        createWorkspaceMedia(mockDatabase, {
          workspaceId,
          contentType: 'image/png',
          buffer: textBuffer,
          uploadDir,
          maxBytes,
          blobStore: mockBlobStore,
        }),
      ).rejects.toMatchObject({
        code: 'MEDIA_CONTENT_MISMATCH',
        statusCode: 400,
      });
    });

    it('rejects HTML declared as JPEG (single-shot upload)', async () => {
      const htmlBuffer = Buffer.from(
        '<html><body>Not an image</body></html>',
        'utf8',
      );

      await expect(
        createWorkspaceMedia(mockDatabase, {
          workspaceId,
          contentType: 'image/jpeg',
          buffer: htmlBuffer,
          uploadDir,
          maxBytes,
          blobStore: mockBlobStore,
        }),
      ).rejects.toMatchObject({
        code: 'MEDIA_CONTENT_MISMATCH',
        statusCode: 400,
      });
    });

    it('rejects PNG bytes declared as JPEG', async () => {
      const pngBuffer = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      ]);

      await expect(
        createWorkspaceMedia(mockDatabase, {
          workspaceId,
          contentType: 'image/jpeg',
          buffer: pngBuffer,
          uploadDir,
          maxBytes,
          blobStore: mockBlobStore,
        }),
      ).rejects.toMatchObject({
        code: 'MEDIA_CONTENT_MISMATCH',
        statusCode: 400,
        message: expect.stringMatching(/declared image\/jpeg.*matches image\/png/),
      });
    });

    it('rejects JPEG bytes declared as PNG', async () => {
      const jpegBuffer = Buffer.from([
        0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
      ]);

      await expect(
        createWorkspaceMedia(mockDatabase, {
          workspaceId,
          contentType: 'image/png',
          buffer: jpegBuffer,
          uploadDir,
          maxBytes,
          blobStore: mockBlobStore,
        }),
      ).rejects.toMatchObject({
        code: 'MEDIA_CONTENT_MISMATCH',
        statusCode: 400,
      });
    });

    it('rejects empty buffer', async () => {
      const emptyBuffer = Buffer.alloc(0);

      await expect(
        createWorkspaceMedia(mockDatabase, {
          workspaceId,
          contentType: 'image/png',
          buffer: emptyBuffer,
          uploadDir,
          maxBytes,
          blobStore: mockBlobStore,
        }),
      ).rejects.toMatchObject({
        code: 'MEDIA_TOO_LARGE',
        statusCode: 400,
      });
    });

    it('rejects truncated buffer', async () => {
      const shortBuffer = Buffer.from([0x89, 0x50, 0x4e]);

      await expect(
        createWorkspaceMedia(mockDatabase, {
          workspaceId,
          contentType: 'image/png',
          buffer: shortBuffer,
          uploadDir,
          maxBytes,
          blobStore: mockBlobStore,
        }),
      ).rejects.toMatchObject({
        code: 'MEDIA_CONTENT_MISMATCH',
        statusCode: 400,
        message: expect.stringMatching(/too short/),
      });
    });

    it('rejects unsupported content type', async () => {
      const svgBuffer = Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
        'utf8',
      );

      await expect(
        createWorkspaceMedia(mockDatabase, {
          workspaceId,
          contentType: 'image/svg+xml',
          buffer: svgBuffer,
          uploadDir,
          maxBytes,
          blobStore: mockBlobStore,
        }),
      ).rejects.toMatchObject({
        code: 'MEDIA_TYPE_UNSUPPORTED',
        statusCode: 400,
      });
    });
  });
});
