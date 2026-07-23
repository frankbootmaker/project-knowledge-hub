import { promises as fs } from 'node:fs';
import path from 'node:path';
import { blobObjectKey } from './factory.js';
import type { BlobStore } from './types.js';

const DUMP_NAME_RE = /^knowledge-hub-[A-Za-z0-9._-]+\.dump$/;

export type OffsiteStamp = {
  kind: string;
  at: string;
  artifact: string;
  schemaVersion: string;
  hostname: string;
  key: string;
  provider: string;
};

function assertSafeDumpName(name: string): string {
  const base = path.basename(name);
  if (base !== name || !DUMP_NAME_RE.test(base)) {
    throw new Error('Dump name must look like knowledge-hub-….dump');
  }
  return base;
}

export async function readOffsiteStamp(
  backupDir: string,
): Promise<OffsiteStamp | null> {
  try {
    const raw = await fs.readFile(path.join(backupDir, 'last-offsite.json'), 'utf8');
    const parsed = JSON.parse(raw) as Partial<OffsiteStamp>;
    if (!parsed.at || typeof parsed.at !== 'string') return null;
    return {
      kind: typeof parsed.kind === 'string' ? parsed.kind : 'offsite',
      at: parsed.at,
      artifact: typeof parsed.artifact === 'string' ? parsed.artifact : '',
      schemaVersion:
        typeof parsed.schemaVersion === 'string' ? parsed.schemaVersion : 'unknown',
      hostname: typeof parsed.hostname === 'string' ? parsed.hostname : 'unknown',
      key: typeof parsed.key === 'string' ? parsed.key : '',
      provider: typeof parsed.provider === 'string' ? parsed.provider : 'unknown',
    };
  } catch {
    return null;
  }
}

export async function uploadDumpOffsite(input: {
  blobStore: BlobStore;
  backupDir: string;
  name: string;
  schemaVersion: string;
}): Promise<{ stamp: OffsiteStamp; key: string }> {
  if (input.blobStore.provider === 'disabled') {
    throw new Error('Blob storage is disabled');
  }

  const name = assertSafeDumpName(input.name);
  const filePath = path.join(input.backupDir, name);
  const buffer = await fs.readFile(filePath);
  if (buffer.byteLength === 0) {
    throw new Error('Dump file is empty');
  }

  const key = blobObjectKey('backups', name);
  await input.blobStore.put({
    key,
    body: buffer,
    contentType: 'application/octet-stream',
  });

  const stamp: OffsiteStamp = {
    kind: 'offsite',
    at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    artifact: filePath,
    schemaVersion: input.schemaVersion,
    hostname: process.env.HOSTNAME ?? 'api',
    key,
    provider: input.blobStore.provider,
  };

  await fs.mkdir(input.backupDir, { recursive: true });
  await fs.writeFile(
    path.join(input.backupDir, 'last-offsite.json'),
    `${JSON.stringify(stamp, null, 2)}\n`,
    'utf8',
  );

  return { stamp, key };
}

export async function syncPendingOffsiteDump(input: {
  blobStore: BlobStore;
  backupDir: string;
  schemaVersion: string;
}): Promise<
  { uploaded: false; reason: string } | { uploaded: true; stamp: OffsiteStamp }
> {
  if (input.blobStore.provider === 'disabled') {
    return { uploaded: false, reason: 'blob_disabled' };
  }

  let success: { at?: string; artifact?: string } | null = null;
  try {
    success = JSON.parse(
      await fs.readFile(path.join(input.backupDir, 'last-success.json'), 'utf8'),
    ) as { at?: string; artifact?: string };
  } catch {
    return { uploaded: false, reason: 'no_local_backup' };
  }

  const artifactName = success.artifact ? path.basename(success.artifact) : '';
  if (!artifactName) {
    return { uploaded: false, reason: 'no_artifact' };
  }

  const offsite = await readOffsiteStamp(input.backupDir);
  if (
    offsite &&
    success.at &&
    offsite.at >= success.at &&
    (path.basename(offsite.artifact) === artifactName ||
      offsite.key.endsWith(`/${artifactName}`))
  ) {
    return { uploaded: false, reason: 'already_offsite' };
  }

  const { stamp } = await uploadDumpOffsite({
    blobStore: input.blobStore,
    backupDir: input.backupDir,
    name: artifactName,
    schemaVersion: input.schemaVersion,
  });
  return { uploaded: true, stamp };
}
