import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { and, desc, eq, isNull } from 'drizzle-orm';
import {
  createDocumentImportConvertQueue,
  enqueueDocumentImportConvertJob,
} from '@project-knowledge-hub/jobs';
import {
  createDraftFromDocumentImportInputSchema,
  detectContentSecrets,
  documentImportLaneSchema,
  documentImportOcrEngineSchema,
  hasHighSeverityWarnings,
  isAllowedUpload,
  titleFromImport,
  type CreateDraftFromDocumentImportInput,
  type DocumentImportLane,
  type DocumentImportOcrEngine,
} from '@project-knowledge-hub/document-import';
import {
  documentImportMedia,
  documentImportRecords,
  documentImports,
  knowledgeRecords,
  workspaceMedia,
  workspaces,
} from '@project-knowledge-hub/database';
import { AppError } from '@project-knowledge-hub/domain';
import { writeAuditEvent } from './identity.js';
import {
  assertProjectInWorkspace,
  assertSystemInWorkspace,
  createKnowledgeRecord,
  type KnowledgeActor,
} from './knowledge-records-service.js';
import {
  deleteImportOriginal,
  writeImportOriginal,
} from './document-import-storage.js';

type ImportRow = typeof documentImports.$inferSelect;

async function loadLinkedRecords(app: FastifyInstance, importId: string) {
  const linked = await app.database.db
    .select({
      knowledgeRecordId: documentImportRecords.knowledgeRecordId,
      title: knowledgeRecords.title,
      slug: knowledgeRecords.slug,
      recordType: knowledgeRecords.recordType,
      lifecycleStatus: knowledgeRecords.lifecycleStatus,
      excerptNote: documentImportRecords.excerptNote,
      createdAt: documentImportRecords.createdAt,
    })
    .from(documentImportRecords)
    .innerJoin(
      knowledgeRecords,
      eq(documentImportRecords.knowledgeRecordId, knowledgeRecords.id),
    )
    .where(eq(documentImportRecords.importId, importId));

  return linked.map((r) => ({
    knowledgeRecordId: r.knowledgeRecordId,
    title: r.title,
    slug: r.slug,
    recordType: r.recordType,
    lifecycleStatus: r.lifecycleStatus,
    excerptNote: r.excerptNote,
    createdAt: r.createdAt.toISOString(),
  }));
}

async function loadMediaLinks(app: FastifyInstance, importId: string) {
  const rows = await app.database.db
    .select({
      workspaceMediaId: documentImportMedia.workspaceMediaId,
      attachmentIndex: documentImportMedia.attachmentIndex,
      originalFilename: workspaceMedia.originalFilename,
      contentType: workspaceMedia.contentType,
      altText: workspaceMedia.altText,
    })
    .from(documentImportMedia)
    .innerJoin(
      workspaceMedia,
      eq(documentImportMedia.workspaceMediaId, workspaceMedia.id),
    )
    .where(eq(documentImportMedia.importId, importId));

  return rows.map((r) => ({
    workspaceMediaId: r.workspaceMediaId,
    attachmentIndex: r.attachmentIndex,
    originalFilename: r.originalFilename,
    contentType: r.contentType,
    altText: r.altText,
    url: `/api/v1/media/${r.workspaceMediaId}`,
  }));
}

export function toPublicDocumentImport(
  row: ImportRow,
  linkedRecords: Awaited<ReturnType<typeof loadLinkedRecords>> = [],
  media: Awaited<ReturnType<typeof loadMediaLinks>> = [],
) {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    systemId: row.systemId,
    title: row.title,
    lane: row.lane,
    status: row.status,
    ocrEngine: row.ocrEngine,
    originalFilename: row.originalFilename,
    contentType: row.contentType,
    byteSize: row.byteSize,
    convertedMarkdown: row.convertedMarkdown,
    contentWarnings: row.contentWarnings ?? [],
    conversionError: row.conversionError,
    conversionWarnings: row.conversionWarnings ?? [],
    createdBy: row.createdBy,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    linkedRecords,
    media,
  };
}

export async function listDocumentImports(
  app: FastifyInstance,
  workspaceId: string,
  options?: { includeArchived?: boolean },
) {
  const rows = await app.database.db
    .select()
    .from(documentImports)
    .where(
      options?.includeArchived
        ? eq(documentImports.workspaceId, workspaceId)
        : and(
            eq(documentImports.workspaceId, workspaceId),
            isNull(documentImports.archivedAt),
          ),
    )
    .orderBy(desc(documentImports.createdAt));

  return Promise.all(
    rows.map(async (row) =>
      toPublicDocumentImport(
        row,
        await loadLinkedRecords(app, row.id),
        await loadMediaLinks(app, row.id),
      ),
    ),
  );
}

export async function getDocumentImport(app: FastifyInstance, importId: string) {
  const [row] = await app.database.db
    .select()
    .from(documentImports)
    .where(eq(documentImports.id, importId))
    .limit(1);
  if (!row) {
    throw new AppError({
      code: 'DOCUMENT_IMPORT_NOT_FOUND',
      message: 'Document import not found',
      statusCode: 404,
    });
  }
  return toPublicDocumentImport(
    row,
    await loadLinkedRecords(app, row.id),
    await loadMediaLinks(app, row.id),
  );
}

export async function createDocumentImport(
  app: FastifyInstance,
  input: {
    workspaceId: string;
    projectId?: string | null;
    systemId?: string | null;
    lane: DocumentImportLane;
    ocrEngine?: DocumentImportOcrEngine;
    filename: string;
    contentType: string;
    buffer: Buffer;
    title?: string;
  },
  actor: KnowledgeActor,
  ipAddress?: string | null,
) {
  if (!app.env.MARKITDOWN_URL) {
    throw new AppError({
      code: 'DOCUMENT_IMPORT_DISABLED',
      message:
        'Document import is disabled (set MARKITDOWN_URL to the kh-markitdown service).',
      statusCode: 503,
    });
  }

  const lane = documentImportLaneSchema.parse(input.lane);
  const ocrEngine = documentImportOcrEngineSchema.parse(
    input.ocrEngine ?? app.env.DOCUMENT_IMPORT_OCR_ENGINE,
  );
  if (ocrEngine === 'vision' && !app.env.VISION_LLM_BASE_URL) {
    throw new AppError({
      code: 'DOCUMENT_IMPORT_OCR_UNAVAILABLE',
      message:
        'Vision OCR requires VISION_LLM_BASE_URL (OpenAI-compatible, e.g. Ollama /v1).',
      statusCode: 400,
    });
  }
  if (
    !isAllowedUpload({
      lane,
      filename: input.filename,
      contentType: input.contentType,
    })
  ) {
    throw new AppError({
      code: 'DOCUMENT_IMPORT_TYPE_UNSUPPORTED',
      message:
        lane === 'image'
          ? 'Images must be JPEG, PNG, WebP, or GIF'
          : 'Unsupported document type (use PDF, DOCX, PPTX, XLSX, HTML, Markdown, or text)',
      statusCode: 400,
    });
  }

  if (
    input.buffer.byteLength === 0 ||
    input.buffer.byteLength > app.env.DOCUMENT_IMPORT_MAX_BYTES
  ) {
    throw new AppError({
      code: 'DOCUMENT_IMPORT_TOO_LARGE',
      message: `File must be between 1 byte and ${app.env.DOCUMENT_IMPORT_MAX_BYTES} bytes`,
      statusCode: 400,
    });
  }

  if (input.projectId) {
    await assertProjectInWorkspace(app.database, input.workspaceId, input.projectId);
  }
  if (input.systemId) {
    await assertSystemInWorkspace(app.database, input.workspaceId, input.systemId);
  }

  const importId = randomUUID();
  const title =
    input.title?.trim() ||
    titleFromImport({ originalFilename: input.filename });

  const { store: blobStore } = await app.getBlobStore();
  const blobKey = await writeImportOriginal({
    uploadDir: app.env.DOCUMENT_IMPORT_DIR,
    workspaceId: input.workspaceId,
    importId,
    buffer: input.buffer,
    contentType: input.contentType,
    blobStore,
  });

  const [row] = await app.database.db
    .insert(documentImports)
    .values({
      id: importId,
      workspaceId: input.workspaceId,
      projectId: input.projectId ?? null,
      systemId: input.systemId ?? null,
      title,
      lane,
      ocrEngine,
      status: 'pending',
      originalFilename: input.filename,
      contentType: input.contentType,
      byteSize: input.buffer.byteLength,
      blobKey,
      createdBy: actor.userId ?? actor.actorId,
    })
    .returning();

  if (!row) {
    await deleteImportOriginal({
      uploadDir: app.env.DOCUMENT_IMPORT_DIR,
      workspaceId: input.workspaceId,
      importId,
      blobKey,
      blobStore,
    });
    throw new AppError({
      code: 'DOCUMENT_IMPORT_CREATE_FAILED',
      message: 'Failed to create document import',
      statusCode: 500,
    });
  }

  const queue = createDocumentImportConvertQueue(app.env.REDIS_URL);
  try {
    await enqueueDocumentImportConvertJob(queue, { importId });
  } finally {
    await queue.close();
  }

  const [workspace] = await app.database.db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, input.workspaceId))
    .limit(1);

  await writeAuditEvent(app.database, {
    organizationId: workspace?.organizationId ?? null,
    actorType: actor.actorType,
    actorId: actor.actorId,
    action: 'document_import.create',
    entityType: 'document_import',
    entityId: importId,
    metadata: {
      lane,
      ocrEngine,
      filename: input.filename,
      byteSize: input.buffer.byteLength,
    },
    ipAddress: ipAddress ?? null,
  });

  return toPublicDocumentImport(row);
}

export async function archiveDocumentImport(
  app: FastifyInstance,
  importId: string,
  actor: KnowledgeActor,
  ipAddress?: string | null,
) {
  const [row] = await app.database.db
    .update(documentImports)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(eq(documentImports.id, importId))
    .returning();
  if (!row) {
    throw new AppError({
      code: 'DOCUMENT_IMPORT_NOT_FOUND',
      message: 'Document import not found',
      statusCode: 404,
    });
  }
  const [workspace] = await app.database.db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, row.workspaceId))
    .limit(1);
  await writeAuditEvent(app.database, {
    organizationId: workspace?.organizationId ?? null,
    actorType: actor.actorType,
    actorId: actor.actorId,
    action: 'document_import.archive',
    entityType: 'document_import',
    entityId: row.id,
    metadata: { title: row.title },
    ipAddress: ipAddress ?? null,
  });
  return toPublicDocumentImport(row);
}

export async function purgeDocumentImport(
  app: FastifyInstance,
  importId: string,
  actor: KnowledgeActor,
  ipAddress?: string | null,
) {
  const [row] = await app.database.db
    .select()
    .from(documentImports)
    .where(eq(documentImports.id, importId))
    .limit(1);
  if (!row) {
    throw new AppError({
      code: 'DOCUMENT_IMPORT_NOT_FOUND',
      message: 'Document import not found',
      statusCode: 404,
    });
  }

  const { store: blobStore } = await app.getBlobStore();
  await deleteImportOriginal({
    uploadDir: app.env.DOCUMENT_IMPORT_DIR,
    workspaceId: row.workspaceId,
    importId: row.id,
    blobKey: row.blobKey,
    blobStore,
  });

  await app.database.db
    .delete(documentImports)
    .where(eq(documentImports.id, row.id));

  const [workspace] = await app.database.db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, row.workspaceId))
    .limit(1);

  await writeAuditEvent(app.database, {
    organizationId: workspace?.organizationId ?? null,
    actorType: actor.actorType,
    actorId: actor.actorId,
    action: 'document_import.purge',
    entityType: 'document_import',
    entityId: row.id,
    metadata: { title: row.title },
    ipAddress: ipAddress ?? null,
  });
}

export async function createDraftFromDocumentImport(
  app: FastifyInstance,
  importId: string,
  input: CreateDraftFromDocumentImportInput,
  actor: KnowledgeActor,
  ipAddress?: string | null,
) {
  const body = createDraftFromDocumentImportInputSchema.parse(input);
  const [row] = await app.database.db
    .select()
    .from(documentImports)
    .where(eq(documentImports.id, importId))
    .limit(1);

  if (!row) {
    throw new AppError({
      code: 'DOCUMENT_IMPORT_NOT_FOUND',
      message: 'Document import not found',
      statusCode: 404,
    });
  }
  if (row.archivedAt) {
    throw new AppError({
      code: 'DOCUMENT_IMPORT_ARCHIVED',
      message: 'Cannot create drafts from an archived import',
      statusCode: 400,
    });
  }
  if (row.status !== 'ready' || !row.convertedMarkdown) {
    throw new AppError({
      code: 'DOCUMENT_IMPORT_NOT_READY',
      message: 'Conversion is not ready yet',
      statusCode: 400,
      details: { status: row.status, conversionError: row.conversionError },
    });
  }

  const contentMarkdown = (body.contentMarkdown ?? row.convertedMarkdown).trim();
  if (!contentMarkdown) {
    throw new AppError({
      code: 'VALIDATION_ERROR',
      message: 'Draft content is empty',
      statusCode: 400,
    });
  }

  const draftWarnings = detectContentSecrets(contentMarkdown);
  if (hasHighSeverityWarnings(draftWarnings) && !body.acknowledgeSecrets) {
    throw new AppError({
      code: 'IMPORT_SECRET_WARNING',
      message:
        'Draft content looks like it may contain secrets. Acknowledge to create the draft anyway.',
      statusCode: 400,
      details: { contentWarnings: draftWarnings },
    });
  }

  const { knowledgeRecord } = await createKnowledgeRecord(
    app,
    {
      workspaceId: row.workspaceId,
      title: body.title ?? row.title,
      recordType: body.recordType ?? 'note',
      lifecycleStatus: 'draft',
      sourceOfTruthMode: 'imported_snapshot',
      contentMarkdown,
      projectId: row.projectId,
      systemId: row.systemId,
      source: {
        sourceType: 'import',
        sourceProvider: 'markitdown',
        sourceReference: row.id,
        sourceTitle: row.title,
        metadata: {
          documentImportId: row.id,
          lane: row.lane,
          originalFilename: row.originalFilename,
        },
      },
    },
    actor,
    ipAddress,
  );

  await app.database.db.insert(documentImportRecords).values({
    importId: row.id,
    knowledgeRecordId: knowledgeRecord.id,
    excerptNote: body.excerptNote ?? null,
  });

  const [workspace] = await app.database.db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, row.workspaceId))
    .limit(1);

  await writeAuditEvent(app.database, {
    organizationId: workspace?.organizationId ?? null,
    actorType: actor.actorType,
    actorId: actor.actorId,
    action: 'document_import.create_record',
    entityType: 'document_import',
    entityId: row.id,
    metadata: {
      knowledgeRecordId: knowledgeRecord.id,
      slug: knowledgeRecord.slug,
    },
    ipAddress: ipAddress ?? null,
  });

  return {
    documentImport: await getDocumentImport(app, row.id),
    knowledgeRecord,
  };
}
