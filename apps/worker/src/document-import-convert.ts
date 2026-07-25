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

const STOREABLE_MEDIA = new Set(['image/jpeg', 'image/png', 'image/webp']);

async function readOriginal(input: {
  env: AppEnv;
  blobStore: BlobStore;
  workspaceId: string;
  importId: string;
  blobKey: string;
}): Promise<Buffer | null> {
  if (input.blobStore.provider !== 'disabled') {
    const fromBlob = await input.blobStore.get(input.blobKey);
    if (fromBlob) return fromBlob;
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
}): Promise<string | null> {
  let contentType = input.contentType.toLowerCase();
  if (contentType === 'image/jpg') contentType = 'image/jpeg';
  if (!STOREABLE_MEDIA.has(contentType)) {
    return null;
  }
  if (
    input.buffer.byteLength === 0 ||
    input.buffer.byteLength > input.env.MEDIA_MAX_BYTES
  ) {
    return null;
  }

  const mediaId = randomUUID();
  const key = blobObjectKey('media', `${input.workspaceId}/${mediaId}`);
  if (input.blobStore.provider !== 'disabled') {
    await input.blobStore.put({
      key,
      body: input.buffer,
      contentType,
    });
  }
  const filePath = path.join(
    path.resolve(input.env.MEDIA_UPLOAD_DIR),
    input.workspaceId,
    mediaId,
  );
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, input.buffer);

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
      let contentType = image.contentType.toLowerCase();
      if (contentType === 'image/jpg') contentType = 'image/jpeg';
      const bytes = Buffer.from(image.dataBase64, 'base64');
      const mediaId = await storeMedia({
        env: input.env,
        database: input.database,
        blobStore: input.blobStore,
        workspaceId: row.workspaceId,
        contentType,
        buffer: bytes,
        originalFilename: image.filename,
        createdBy: row.createdBy,
        altText: path.parse(image.filename).name,
      });
      if (!mediaId) {
        warnings.push(`Skipped non-storeable image: ${image.filename}`);
        continue;
      }
      mediaByIndex.set(i, { id: mediaId, filename: image.filename });
      await input.database.db.insert(documentImportMedia).values({
        importId: row.id,
        workspaceMediaId: mediaId,
        attachmentIndex: i,
      });
    }

    const markdown = sanitizePgText(
      rewriteAttachmentPlaceholders(converted.markdown, mediaByIndex),
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
