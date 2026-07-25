import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import {
  blobObjectKey,
  type BlobStore,
} from '@project-knowledge-hub/blob-store';
import type { AppEnv } from '@project-knowledge-hub/config';
import {
  documentImportMedia,
  documentImports,
  workspaceMedia,
  type Database,
} from '@project-knowledge-hub/database';
import {
  convertWithMarkItDown,
  detectContentSecrets,
  rewriteAttachmentPlaceholders,
  sanitizePgText,
  titleFromImport,
} from '@project-knowledge-hub/document-import';

const STOREABLE_MEDIA = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

function normalizeImageContentType(
  declared: string,
  filename: string,
  buffer: Buffer,
): string | null {
  let contentType = declared.toLowerCase().split(';')[0]?.trim() ?? '';
  if (contentType === 'image/jpg') contentType = 'image/jpeg';
  if (STOREABLE_MEDIA.has(contentType)) return contentType;

  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    return 'image/jpeg';
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return 'image/png';
  }
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (buffer.length >= 6 && buffer.toString('ascii', 0, 3) === 'GIF') {
    return 'image/gif';
  }

  const ext = path.extname(filename).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  return null;
}

async function readOriginal(input: {
  env: AppEnv;
  blobStore: BlobStore;
  workspaceId: string;
  importId: string;
  blobKey: string;
}): Promise<Buffer | null> {
  if (input.blobStore.provider !== 'disabled') {
    try {
      const fromBlob = await input.blobStore.get(input.blobKey);
      if (fromBlob) return fromBlob;
    } catch {
      // Fall through to local shared volume (broken S3 credentials, etc.).
    }
  }
  try {
    return await readFile(
      path.join(
        path.resolve(input.env.DOCUMENT_IMPORT_DIR),
        input.workspaceId,
        input.importId,
      ),
    );
  } catch {
    return null;
  }
}

async function storeMedia(input: {
  env: AppEnv;
  database: Database;
  blobStore: BlobStore;
  workspaceId: string;
  contentType: string;
  buffer: Buffer;
  originalFilename: string;
  createdBy: string;
  altText?: string;
  warnings?: string[];
  /** Override MEDIA_MAX_BYTES (document imports may be larger than library uploads). */
  maxBytes?: number;
}): Promise<string | null> {
  const contentType = normalizeImageContentType(
    input.contentType,
    input.originalFilename,
    input.buffer,
  );
  if (!contentType) {
    input.warnings?.push(
      `Skipped non-storeable image type (${input.contentType || 'unknown'}): ${input.originalFilename}`,
    );
    return null;
  }
  const maxBytes = input.maxBytes ?? input.env.MEDIA_MAX_BYTES;
  if (input.buffer.byteLength === 0 || input.buffer.byteLength > maxBytes) {
    input.warnings?.push(
      `Skipped image over size limit (${input.buffer.byteLength} > ${maxBytes}): ${input.originalFilename}`,
    );
    return null;
  }

  const mediaId = randomUUID();
  const key = blobObjectKey('media', `${input.workspaceId}/${mediaId}`);
  // Local first so convert succeeds when S3 credentials are invalid.
  const filePath = path.join(
    path.resolve(input.env.MEDIA_UPLOAD_DIR),
    input.workspaceId,
    mediaId,
  );
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, input.buffer);

  if (input.blobStore.provider !== 'disabled') {
    try {
      await input.blobStore.put({
        key,
        body: input.buffer,
        contentType,
      });
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : 'unknown object-store error';
      input.warnings?.push(
        `Object storage put failed for media; using local file (${detail})`,
      );
    }
  }

  await input.database.db.insert(workspaceMedia).values({
    id: mediaId,
    workspaceId: input.workspaceId,
    contentType,
    byteSize: input.buffer.byteLength,
    originalFilename: input.originalFilename,
    altText: input.altText ?? null,
    createdBy: input.createdBy,
  });

  return mediaId;
}

export async function processDocumentImportConvert(input: {
  env: AppEnv;
  database: Database;
  blobStore: BlobStore;
  importId: string;
  log: { info: (obj: unknown, msg?: string) => void; warn: (obj: unknown, msg?: string) => void };
}): Promise<void> {
  const [row] = await input.database.db
    .select()
    .from(documentImports)
    .where(eq(documentImports.id, input.importId))
    .limit(1);

  if (!row) {
    input.log.warn({ importId: input.importId }, 'document import missing');
    return;
  }

  if (row.status === 'ready' && row.convertedMarkdown) {
    return;
  }

  if (!input.env.MARKITDOWN_URL) {
    await input.database.db
      .update(documentImports)
      .set({
        status: 'failed',
        conversionError: 'MARKITDOWN_URL is not configured',
        updatedAt: new Date(),
      })
      .where(eq(documentImports.id, row.id));
    return;
  }

  await input.database.db
    .update(documentImports)
    .set({ status: 'converting', conversionError: null, updatedAt: new Date() })
    .where(eq(documentImports.id, row.id));

  // Allow safe retries after a partial convert (media rows / prior markdown).
  await input.database.db
    .delete(documentImportMedia)
    .where(eq(documentImportMedia.importId, row.id));

  try {
    const buffer = await readOriginal({
      env: input.env,
      blobStore: input.blobStore,
      workspaceId: row.workspaceId,
      importId: row.id,
      blobKey: row.blobKey,
    });
    if (!buffer) {
      throw new Error('Original upload bytes not found');
    }

    const converted = await convertWithMarkItDown({
      baseUrl: input.env.MARKITDOWN_URL,
      timeoutMs: input.env.MARKITDOWN_TIMEOUT_MS,
      filename: row.originalFilename,
      contentType: row.contentType,
      buffer,
      lane: row.lane === 'image' ? 'image' : 'document',
      ocrEngine:
        row.ocrEngine === 'vision' || row.ocrEngine === 'tesseract'
          ? row.ocrEngine
          : 'none',
      ocrLang:
        row.ocrLang === 'deu' || row.ocrLang === 'hun' || row.ocrLang === 'eng'
          ? row.ocrLang
          : 'eng',
    });

    const mediaByIndex = new Map<
      number,
      { id: string; filename?: string | null }
    >();
    const warnings = [...(converted.warnings ?? [])];

    for (let i = 0; i < converted.images.length; i += 1) {
      const image = converted.images[i]!;
      const bytes = Buffer.from(image.dataBase64, 'base64');
      const mediaId = await storeMedia({
        env: input.env,
        database: input.database,
        blobStore: input.blobStore,
        workspaceId: row.workspaceId,
        contentType: image.contentType,
        buffer: bytes,
        originalFilename: image.filename,
        createdBy: row.createdBy,
        altText: path.parse(image.filename).name,
        warnings,
        // Sidecar may re-encode the same upload; allow import-sized media.
        maxBytes: input.env.DOCUMENT_IMPORT_MAX_BYTES,
      });
      if (!mediaId) {
        continue;
      }
      mediaByIndex.set(i, { id: mediaId, filename: image.filename });
      await input.database.db.insert(documentImportMedia).values({
        importId: row.id,
        workspaceMediaId: mediaId,
        attachmentIndex: i,
      });
    }

    // Image lane: always attach the original upload when the sidecar omitted or
    // oversized base64 attachments (common for multi‑MB phone photos on Dokploy).
    let markdownSource = converted.markdown;
    if (row.lane === 'image' && !mediaByIndex.has(0)) {
      const mediaId = await storeMedia({
        env: input.env,
        database: input.database,
        blobStore: input.blobStore,
        workspaceId: row.workspaceId,
        contentType: row.contentType,
        buffer,
        originalFilename: row.originalFilename,
        createdBy: row.createdBy,
        altText: path.parse(row.originalFilename).name,
        warnings,
        maxBytes: input.env.DOCUMENT_IMPORT_MAX_BYTES,
      });
      if (mediaId) {
        mediaByIndex.set(0, {
          id: mediaId,
          filename: row.originalFilename,
        });
        await input.database.db.insert(documentImportMedia).values({
          importId: row.id,
          workspaceMediaId: mediaId,
          attachmentIndex: 0,
        });
        if (
          !markdownSource.includes('attachment:0') &&
          !markdownSource.includes('/api/v1/media/')
        ) {
          const alt = path.parse(row.originalFilename).name || 'image';
          markdownSource = `![${alt}](attachment:0)\n\n${markdownSource}`;
        }
      }
    }

    const markdown = sanitizePgText(
      rewriteAttachmentPlaceholders(markdownSource, mediaByIndex),
    );
    const contentWarnings = detectContentSecrets(markdown);
    const title = sanitizePgText(
      titleFromImport({
        titleHint: converted.titleHint ?? row.title,
        originalFilename: row.originalFilename,
      }),
    );

    await input.database.db
      .update(documentImports)
      .set({
        status: 'ready',
        title,
        convertedMarkdown: markdown,
        contentWarnings,
        conversionWarnings: warnings.map(sanitizePgText),
        conversionError: null,
        updatedAt: new Date(),
      })
      .where(eq(documentImports.id, row.id));

    input.log.info(
      {
        importId: row.id,
        images: mediaByIndex.size,
        visionUsed: converted.visionUsed ?? false,
      },
      'document import converted',
    );
  } catch (error) {
    const message = sanitizePgText(
      error instanceof Error ? error.message.slice(0, 1000) : String(error),
    );
    await input.database.db
      .update(documentImports)
      .set({
        status: 'failed',
        conversionError: message,
        updatedAt: new Date(),
      })
      .where(eq(documentImports.id, row.id));
    throw error;
  }
}
