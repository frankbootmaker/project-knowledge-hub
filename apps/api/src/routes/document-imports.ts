import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  createDraftFromDocumentImportInputSchema,
  documentImportLaneSchema,
} from '@project-knowledge-hub/document-import';
import { AppError } from '@project-knowledge-hub/domain';
import {
  requireWorkspaceAdmin,
  requireWorkspaceMaintainer,
  requireWorkspaceView,
} from '@project-knowledge-hub/permissions';
import {
  assertMutatingOrigin,
  requireAuthenticated,
} from '../plugins/auth.js';
import {
  archiveDocumentImport,
  createDocumentImport,
  createDraftFromDocumentImport,
  getDocumentImport,
  listDocumentImports,
  purgeDocumentImport,
} from '../lib/document-import-service.js';

export async function registerDocumentImportRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get('/api/v1/document-imports', async (request) => {
    const principal = requireAuthenticated(request);
    const query = z
      .object({
        workspaceId: z.string().uuid(),
        includeArchived: z
          .enum(['true', 'false'])
          .optional()
          .transform((value) => value === 'true'),
      })
      .parse(request.query);

    requireWorkspaceView(principal, query.workspaceId);
    const imports = await listDocumentImports(app, query.workspaceId, {
      includeArchived: query.includeArchived,
    });
    return { documentImports: imports };
  });

  app.get('/api/v1/document-imports/:id', async (request) => {
    const principal = requireAuthenticated(request);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const documentImport = await getDocumentImport(app, params.id);
    requireWorkspaceView(principal, documentImport.workspaceId);
    return { documentImport };
  });

  app.post('/api/v1/document-imports', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);

    const contentType = request.headers['content-type'] ?? '';
    if (!contentType.includes('multipart/form-data')) {
      throw new AppError({
        code: 'VALIDATION_ERROR',
        message: 'Expected multipart/form-data',
        statusCode: 400,
      });
    }

    const parts = request.parts();
    let workspaceId: string | undefined;
    let projectId: string | null | undefined;
    let systemId: string | null | undefined;
    let lane = 'document';
    let title: string | undefined;
    let fileBuffer: Buffer | undefined;
    let filename = 'upload.bin';
    let fileContentType = 'application/octet-stream';

    for await (const part of parts) {
      if (part.type === 'file') {
        const chunks: Buffer[] = [];
        for await (const chunk of part.file) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        fileBuffer = Buffer.concat(chunks);
        filename = part.filename || filename;
        fileContentType = part.mimetype || fileContentType;
      } else {
        const value = String(part.value ?? '');
        if (part.fieldname === 'workspaceId') workspaceId = value;
        if (part.fieldname === 'projectId') {
          projectId = value.trim() ? value : null;
        }
        if (part.fieldname === 'systemId') {
          systemId = value.trim() ? value : null;
        }
        if (part.fieldname === 'lane') lane = value;
        if (part.fieldname === 'title') title = value;
      }
    }

    if (!workspaceId || !fileBuffer) {
      throw new AppError({
        code: 'VALIDATION_ERROR',
        message: 'workspaceId and file are required',
        statusCode: 400,
      });
    }

    z.string().uuid().parse(workspaceId);
    const parsedLane = documentImportLaneSchema.parse(lane);
    requireWorkspaceMaintainer(principal, workspaceId);

    const documentImport = await createDocumentImport(
      app,
      {
        workspaceId,
        projectId,
        systemId,
        lane: parsedLane,
        filename,
        contentType: fileContentType,
        buffer: fileBuffer,
        title,
      },
      {
        actorType: 'user',
        actorId: principal.userId,
        userId: principal.userId,
      },
      request.ip,
    );

    return { documentImport };
  });

  app.post('/api/v1/document-imports/:id/records', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = createDraftFromDocumentImportInputSchema.parse(request.body);
    const existing = await getDocumentImport(app, params.id);
    requireWorkspaceMaintainer(principal, existing.workspaceId);

    return createDraftFromDocumentImport(
      app,
      params.id,
      body,
      {
        actorType: 'user',
        actorId: principal.userId,
        userId: principal.userId,
      },
      request.ip,
    );
  });

  app.post('/api/v1/document-imports/:id/archive', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const existing = await getDocumentImport(app, params.id);
    requireWorkspaceAdmin(principal, existing.workspaceId);
    const documentImport = await archiveDocumentImport(
      app,
      params.id,
      {
        actorType: 'user',
        actorId: principal.userId,
        userId: principal.userId,
      },
      request.ip,
    );
    return { documentImport };
  });

  app.post('/api/v1/document-imports/:id/purge', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const existing = await getDocumentImport(app, params.id);
    requireWorkspaceAdmin(principal, existing.workspaceId);
    await purgeDocumentImport(
      app,
      params.id,
      {
        actorType: 'user',
        actorId: principal.userId,
        userId: principal.userId,
      },
      request.ip,
    );
    return { purged: params.id };
  });
}
