import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { BlobStore } from '@project-knowledge-hub/blob-store';
import {
  blankExportChrome,
  blankPublicStylePack,
  interpolateStyleTemplate,
  readStylePackLogo,
  slugifyStylePackLabel,
  stylePackLogoBlobKey,
  writeStylePackLogo,
} from './style-packs.js';

describe('style-packs helpers', () => {
  it('exposes a synthetic Blank pack', () => {
    const pack = blankPublicStylePack();
    expect(pack.id).toBe('blank');
    expect(pack.builtin).toBe(true);
    expect(pack.formats).toEqual(['pdf', 'docx']);
  });

  it('builds Blank export chrome without a logo', () => {
    const chrome = blankExportChrome();
    expect(chrome.id).toBe('blank');
    expect(chrome.logoDataUri).toBeNull();
    expect(chrome.chrome.showLogo).toBe(false);
  });

  it('slugifies labels for new packs', () => {
    expect(slugifyStylePackLabel('Corporate Letterhead')).toBe(
      'corporate-letterhead',
    );
  });

  it('interpolates header/footer templates', () => {
    expect(
      interpolateStyleTemplate('{title} · p{page}/{pages}', {
        title: 'Q3 Report',
        page: '2',
        pages: '10',
      }),
    ).toBe('Q3 Report · p2/10');
  });

  it('builds doc-templates blob keys', () => {
    expect(
      stylePackLogoBlobKey(
        '00000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000002',
        'png',
      ),
    ).toBe(
      'doc-templates/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000002/logo.png',
    );
  });
});

describe('style-pack logo storage', () => {
  let uploadDir = '';

  afterEach(async () => {
    if (uploadDir) {
      await rm(uploadDir, { recursive: true, force: true });
      uploadDir = '';
    }
  });

  it('keeps the local logo when object storage put fails', async () => {
    uploadDir = await mkdtemp(path.join(tmpdir(), 'style-pack-logo-'));
    const blobKey =
      'doc-templates/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000002/logo.png';
    const buffer = Buffer.from('fake-png-bytes');
    const failingStore = {
      provider: 's3' as const,
      async put() {
        throw new Error('getaddrinfo ENOTFOUND s3.auto.amazonaws.com');
      },
      async get() {
        return null;
      },
      async delete() {
        return;
      },
      async list() {
        return [];
      },
    } satisfies BlobStore;

    await writeStylePackLogo({
      uploadDir,
      blobKey,
      buffer,
      contentType: 'image/png',
      blobStore: failingStore,
    });

    const local = await readFile(
      path.join(
        uploadDir,
        '00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000002/logo.png',
      ),
    );
    expect(local.equals(buffer)).toBe(true);

    const viaRead = await readStylePackLogo({
      uploadDir,
      blobKey,
      blobStore: failingStore,
    });
    expect(viaRead?.equals(buffer)).toBe(true);
  });
});
