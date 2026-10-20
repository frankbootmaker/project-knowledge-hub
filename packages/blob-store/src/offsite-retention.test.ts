import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  DeleteObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import { describe, expect, it, vi } from 'vitest';
import { createS3BlobStore } from './s3.js';
import { pruneOffsiteBackups, runOffsiteBackupCycle } from './offsite-retention.js';
import type { BlobStore } from './types.js';

const POLICY = { keepDaily: 7, keepWeekly: 4, keepMonthly: 3 };
const NOW = Date.parse('2026-10-20T12:00:00Z');

function object(key: string, iso: string) {
  return { key, lastModified: new Date(iso), sizeBytes: 4 };
}

describe('pruneOffsiteBackups', () => {
  it('lists backups/ and deletes objects outside the policy with a mocked client', async () => {
    const deleted: string[] = [];
    let listedPrefix = '';
    const store: BlobStore = {
      provider: 's3',
      async put() {
        throw new Error('not used');
      },
      async get() {
        return null;
      },
      async delete(key: string) {
        deleted.push(key);
      },
      async list(prefix: string) {
        listedPrefix = prefix;
        return [
          object('backups/knowledge-hub-today-new.dump', '2026-10-20T11:00:00Z'),
          object('backups/knowledge-hub-today-old.dump', '2026-10-20T01:00:00Z'),
          object('backups/knowledge-hub-yesterday.dump', '2026-10-19T08:00:00Z'),
          object('backups/knowledge-hub-ancient.dump', '2024-01-01T00:00:00Z'),
        ];
      },
    };

    const result = await pruneOffsiteBackups({
      blobStore: store,
      policy: POLICY,
      nowMs: NOW,
      protectKeys: ['dev/backups/knowledge-hub-yesterday.dump'],
    });

    expect(listedPrefix).toBe('backups/');
    expect(deleted).toEqual([
      'backups/knowledge-hub-today-old.dump',
      'backups/knowledge-hub-ancient.dump',
    ]);
    expect(result.kept).toBe(2);
    expect(result.deleted).toEqual(deleted);
  });

  it('never deletes the newest successful copy', async () => {
    const deleted: string[] = [];
    const store: BlobStore = {
      provider: 's3',
      async put() {},
      async get() {
        return null;
      },
      async delete(key: string) {
        deleted.push(key);
      },
      async list() {
        return [
          object('backups/knowledge-hub-newer.dump', '2026-10-20T11:00:00Z'),
          object('backups/knowledge-hub-success.dump', '2026-10-20T09:00:00Z'),
        ];
      },
    };

    await pruneOffsiteBackups({
      blobStore: store,
      policy: POLICY,
      nowMs: NOW,
      protectKeys: ['backups/knowledge-hub-success.dump'],
    });

    expect(deleted).toEqual([]);
  });
});

describe('runOffsiteBackupCycle', () => {
  it('prunes S3 when the upload fails', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'kh-offsite-'));
    const artifact = path.join(dir, 'knowledge-hub-today-new.dump');
    await writeFile(artifact, 'dump-bytes');
    await writeFile(
      path.join(dir, 'last-success.json'),
      `${JSON.stringify({ at: '2026-10-20T11:00:00Z', artifact })}\n`,
    );

    const deleted: string[] = [];
    const store: BlobStore = {
      provider: 's3',
      async put() {
        throw new Error('bucket full');
      },
      async get() {
        return null;
      },
      async delete(key: string) {
        deleted.push(key);
      },
      async list(prefix: string) {
        expect(prefix).toBe('backups/');
        return [
          object('backups/knowledge-hub-today-new.dump', '2026-10-20T11:00:00Z'),
          object('backups/knowledge-hub-today-old.dump', '2026-10-20T01:00:00Z'),
          object('backups/knowledge-hub-yesterday.dump', '2026-10-19T08:00:00Z'),
        ];
      },
    };

    const result = await runOffsiteBackupCycle({
      blobStore: store,
      backupDir: dir,
      schemaVersion: 'test',
      policy: POLICY,
      prune: true,
      nowMs: NOW,
    });

    expect(result.uploadError).toMatch(/bucket full/);
    expect(result.upload).toEqual({ uploaded: false, reason: 'upload_failed' });
    expect(deleted).toEqual(['backups/knowledge-hub-today-old.dump']);
    expect(deleted).not.toContain('backups/knowledge-hub-today-new.dump');

    const errorStamp = JSON.parse(
      await readFile(path.join(dir, 'last-offsite-error.json'), 'utf8'),
    ) as { message: string; at: string };
    expect(errorStamp.message).toMatch(/bucket full/);
    expect(errorStamp.at).toBeTruthy();

    const rotation = JSON.parse(
      await readFile(path.join(dir, 'last-s3-rotation.json'), 'utf8'),
    ) as { kept: number; deleted: number; error: string | null };
    expect(rotation.error).toBeNull();
    expect(rotation.deleted).toBe(1);
    expect(rotation.kept).toBe(2);
  });
});

describe('createS3BlobStore list', () => {
  it('pages through <env>/backups/ and delete uses the prefixed key', async () => {
    const deleted: string[] = [];
    const send = vi.fn(async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
      if (command instanceof ListObjectsV2Command) {
        expect(command.input.Prefix).toBe('dev/backups/');
        if (!command.input.ContinuationToken) {
          return {
            IsTruncated: true,
            NextContinuationToken: 'page-2',
            Contents: [
              {
                Key: 'dev/backups/knowledge-hub-today-new.dump',
                Size: 3,
                LastModified: new Date('2026-10-20T11:00:00Z'),
              },
              {
                Key: 'dev/backups/knowledge-hub-today-old.dump',
                Size: 3,
                LastModified: new Date('2026-10-20T01:00:00Z'),
              },
            ],
          };
        }
        expect(command.input.ContinuationToken).toBe('page-2');
        return {
          IsTruncated: false,
          Contents: [
            {
              Key: 'dev/backups/knowledge-hub-ancient.dump',
              Size: 3,
              LastModified: new Date('2024-01-01T00:00:00Z'),
            },
          ],
        };
      }
      if (command instanceof DeleteObjectCommand) {
        deleted.push(String(command.input.Key));
        return {};
      }
      throw new Error(`unexpected command ${command.constructor.name}`);
    });

    const store = createS3BlobStore(
      {
        provider: 's3',
        bucket: 'kh',
        region: 'auto',
        accessKeyId: 'key',
        secretAccessKey: 'secret',
        forcePathStyle: true,
        keyPrefix: 'dev',
      },
      { send } as unknown as S3Client,
    );

    const result = await pruneOffsiteBackups({
      blobStore: store,
      policy: POLICY,
      nowMs: NOW,
    });

    expect(result.deleted).toEqual([
      'backups/knowledge-hub-today-old.dump',
      'backups/knowledge-hub-ancient.dump',
    ]);
    expect(deleted).toEqual([
      'dev/backups/knowledge-hub-today-old.dump',
      'dev/backups/knowledge-hub-ancient.dump',
    ]);
    expect(deleted).not.toContain('dev/backups/knowledge-hub-today-new.dump');
  });
});
