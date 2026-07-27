import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { organizations, stylePacks } from '@project-knowledge-hub/database';
import { AppError } from '@project-knowledge-hub/domain';
import { requireSystemAdmin } from '@project-knowledge-hub/permissions';
import {
  assertMutatingOrigin,
  requireAuthenticated,
} from '../plugins/auth.js';
import { getDefaultOrganization, writeAuditEvent } from '../lib/identity.js';
import {
  blankPublicStylePack,
  deleteStylePackLogo,
  isAllowedStylePackLogoType,
  listStylePacksForOrganization,
  logoContentTypeToExt,
  readStylePackLogo,
  slugifyStylePackLabel,
  stylePackChromeSchema,
  stylePackLogoBlobKey,
  stylePackTypographySchema,
  toPublicStylePack,
  writeStylePackLogo,
  BLANK_STYLE_PACK_ID,
  type PublicStylePack,
} from '../lib/style-packs.js';

const formatsSchema = z.array(z.enum(['pdf', 'docx'])).min(1).max(2);

const createSchema = z.object({
  organizationId: z.string().uuid().optional(),
  label: z.string().min(1).max(160),
  slug: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .optional(),
  formats: formatsSchema.optional(),
  typography: stylePackTypographySchema.optional(),
  chrome: stylePackChromeSchema.optional(),
});

const updateSchema = z.object({
  label: z.string().min(1).max(160).optional(),
  formats: formatsSchema.optional(),
  typography: stylePackTypographySchema.optional(),
  chrome: stylePackChromeSchema.optional(),
  status: z.enum(['active', 'archived']).optional(),
});

const previewSchema = z.object({
  format: z.enum(['pdf', 'docx']).default('docx'),
});

async function resolveOrganizationId(
  app: FastifyInstance,
  requested?: string,
): Promise<string> {
  if (requested) {
    const [org] = await app.database.db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, requested))
      .limit(1);
    if (!org) {
      throw new AppError({
        code: 'ORGANIZATION_NOT_FOUND',
        message: 'Organization not found',
        statusCode: 404,
      });
    }
    return org.id;
  }
  const fallback = await getDefaultOrganization(app.database);
  if (!fallback) {
    throw new AppError({
      code: 'ORGANIZATION_NOT_FOUND',
      message: 'No organization configured',
      statusCode: 404,
    });
  }
  return fallback.id;
}

export async function registerDocFactoryAdminRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get('/api/v1/admin/doc-factory/style-packs', async (request) => {
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);
    const query = z
      .object({
        organizationId: z.string().uuid().optional(),
        includeArchived: z
          .enum(['true', 'false'])
          .optional()
          .transform((value) => value === 'true'),
      })
      .parse(request.query);

    const organizationId = await resolveOrganizationId(
      app,
      query.organizationId,
    );
    const packs = await listStylePacksForOrganization(
      app.database,
      organizationId,
      { includeArchived: query.includeArchived },
    );

    return {
      organizationId,
      stylePacks: [blankPublicStylePack(), ...packs] satisfies PublicStylePack[],
    };
  });

  app.post('/api/v1/admin/doc-factory/style-packs', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);
    const body = createSchema.parse(request.body);
    const organizationId = await resolveOrganizationId(
      app,
      body.organizationId,
    );
    const slug = body.slug ?? slugifyStylePackLabel(body.label);
    if (slug === BLANK_STYLE_PACK_ID) {
      throw new AppError({
        code: 'STYLE_PACK_SLUG_RESERVED',
        message: 'Slug "blank" is reserved for the built-in pack',
        statusCode: 400,
      });
    }

    const [created] = await app.database.db
      .insert(stylePacks)
      .values({
        organizationId,
        slug,
        label: body.label.trim(),
        formats: body.formats ?? ['pdf', 'docx'],
        typography: body.typography ?? {},
        chrome: body.chrome ?? {},
        createdBy: principal.userId,
      })
      .returning();

    if (!created) {
      throw new AppError({
        code: 'STYLE_PACK_CREATE_FAILED',
        message: 'Could not create style pack',
        statusCode: 500,
      });
    }

    await writeAuditEvent(app.database, {
      organizationId,
      actorType: 'user',
      actorId: principal.userId,
      action: 'doc_factory.style_pack.create',
      entityType: 'style_pack',
      entityId: created.id,
      metadata: { slug: created.slug, label: created.label },
      ipAddress: request.ip,
    });

    return { stylePack: toPublicStylePack(created) };
  });

  app.get('/api/v1/admin/doc-factory/style-packs/:id', async (request) => {
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const [row] = await app.database.db
      .select()
      .from(stylePacks)
      .where(eq(stylePacks.id, params.id))
      .limit(1);
    if (!row) {
      throw new AppError({
        code: 'STYLE_PACK_NOT_FOUND',
        message: 'Style pack not found',
        statusCode: 404,
      });
    }
    return { stylePack: toPublicStylePack(row) };
  });

  app.patch('/api/v1/admin/doc-factory/style-packs/:id', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = updateSchema.parse(request.body);

    const [existing] = await app.database.db
      .select()
      .from(stylePacks)
      .where(eq(stylePacks.id, params.id))
      .limit(1);
    if (!existing) {
      throw new AppError({
        code: 'STYLE_PACK_NOT_FOUND',
        message: 'Style pack not found',
        statusCode: 404,
      });
    }

    const [updated] = await app.database.db
      .update(stylePacks)
      .set({
        label: body.label?.trim() ?? existing.label,
        formats: body.formats ?? existing.formats,
        typography: body.typography ?? existing.typography,
        chrome: body.chrome ?? existing.chrome,
        status: body.status ?? existing.status,
        updatedAt: new Date(),
      })
      .where(eq(stylePacks.id, params.id))
      .returning();

    if (!updated) {
      throw new AppError({
        code: 'STYLE_PACK_NOT_FOUND',
        message: 'Style pack not found',
        statusCode: 404,
      });
    }

    await writeAuditEvent(app.database, {
      organizationId: updated.organizationId,
      actorType: 'user',
      actorId: principal.userId,
      action:
        body.status === 'archived'
          ? 'doc_factory.style_pack.archive'
          : 'doc_factory.style_pack.update',
      entityType: 'style_pack',
      entityId: updated.id,
      metadata: {
        slug: updated.slug,
        status: updated.status,
        fields: Object.keys(body),
      },
      ipAddress: request.ip,
    });

    return { stylePack: toPublicStylePack(updated) };
  });

  app.delete('/api/v1/admin/doc-factory/style-packs/:id', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);

    const [existing] = await app.database.db
      .select()
      .from(stylePacks)
      .where(eq(stylePacks.id, params.id))
      .limit(1);
    if (!existing) {
      throw new AppError({
        code: 'STYLE_PACK_NOT_FOUND',
        message: 'Style pack not found',
        statusCode: 404,
      });
    }

    const { store: blobStore } = await app.getBlobStore();
    if (existing.logoBlobKey) {
      await deleteStylePackLogo({
        uploadDir: app.env.STYLE_PACK_UPLOAD_DIR,
        blobKey: existing.logoBlobKey,
        blobStore,
      });
    }

    await app.database.db
      .delete(stylePacks)
      .where(eq(stylePacks.id, params.id));

    await writeAuditEvent(app.database, {
      organizationId: existing.organizationId,
      actorType: 'user',
      actorId: principal.userId,
      action: 'doc_factory.style_pack.delete',
      entityType: 'style_pack',
      entityId: existing.id,
      metadata: { slug: existing.slug, label: existing.label },
      ipAddress: request.ip,
    });

    return { ok: true, id: existing.id };
  });

  app.post(
    '/api/v1/admin/doc-factory/style-packs/:id/logo',
    async (request) => {
      assertMutatingOrigin(app, request);
      const principal = requireAuthenticated(request);
      requireSystemAdmin(principal);
      const params = z.object({ id: z.string().uuid() }).parse(request.params);

      const [existing] = await app.database.db
        .select()
        .from(stylePacks)
        .where(eq(stylePacks.id, params.id))
        .limit(1);
      if (!existing) {
        throw new AppError({
          code: 'STYLE_PACK_NOT_FOUND',
          message: 'Style pack not found',
          statusCode: 404,
        });
      }

      const file = await request.file();
      if (!file) {
        throw new AppError({
          code: 'STYLE_PACK_LOGO_REQUIRED',
          message: 'Logo image file is required',
          statusCode: 400,
        });
      }

      const contentType = file.mimetype;
      if (!isAllowedStylePackLogoType(contentType)) {
        throw new AppError({
          code: 'STYLE_PACK_LOGO_TYPE_UNSUPPORTED',
          message: 'Logo must be JPEG, PNG, or WebP',
          statusCode: 400,
        });
      }

      const buffer = await file.toBuffer();
      const truncated =
        'fileTruncated' in file &&
        Boolean((file as { fileTruncated?: boolean }).fileTruncated);
      if (truncated) {
        throw new AppError({
          code: 'STYLE_PACK_LOGO_TOO_LARGE',
          message: `Logo is too large (max ${app.env.STYLE_PACK_LOGO_MAX_BYTES} bytes)`,
          statusCode: 400,
        });
      }
      if (buffer.byteLength === 0) {
        throw new AppError({
          code: 'STYLE_PACK_LOGO_EMPTY',
          message: 'Logo file is empty',
          statusCode: 400,
        });
      }
      if (buffer.byteLength > app.env.STYLE_PACK_LOGO_MAX_BYTES) {
        throw new AppError({
          code: 'STYLE_PACK_LOGO_TOO_LARGE',
          message: `Logo is too large (max ${app.env.STYLE_PACK_LOGO_MAX_BYTES} bytes)`,
          statusCode: 400,
        });
      }

      const blobKey = stylePackLogoBlobKey(
        existing.organizationId,
        existing.id,
        logoContentTypeToExt(contentType),
      );
      const { store: blobStore } = await app.getBlobStore();

      if (existing.logoBlobKey && existing.logoBlobKey !== blobKey) {
        await deleteStylePackLogo({
          uploadDir: app.env.STYLE_PACK_UPLOAD_DIR,
          blobKey: existing.logoBlobKey,
          blobStore,
        });
      }

      await writeStylePackLogo({
        uploadDir: app.env.STYLE_PACK_UPLOAD_DIR,
        blobKey,
        buffer,
        contentType,
        blobStore,
      });

      const [updated] = await app.database.db
        .update(stylePacks)
        .set({
          logoBlobKey: blobKey,
          logoContentType: contentType,
          updatedAt: new Date(),
        })
        .where(eq(stylePacks.id, params.id))
        .returning();

      await writeAuditEvent(app.database, {
        organizationId: existing.organizationId,
        actorType: 'user',
        actorId: principal.userId,
        action: 'doc_factory.style_pack.logo_upload',
        entityType: 'style_pack',
        entityId: existing.id,
        metadata: { contentType, bytes: buffer.byteLength },
        ipAddress: request.ip,
      });

      return { stylePack: toPublicStylePack(updated!) };
    },
  );

  app.get(
    '/api/v1/admin/doc-factory/style-packs/:id/logo',
    async (request, reply) => {
      const principal = requireAuthenticated(request);
      requireSystemAdmin(principal);
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      const [existing] = await app.database.db
        .select()
        .from(stylePacks)
        .where(eq(stylePacks.id, params.id))
        .limit(1);
      if (!existing?.logoBlobKey || !existing.logoContentType) {
        throw new AppError({
          code: 'STYLE_PACK_LOGO_NOT_FOUND',
          message: 'Style pack logo not found',
          statusCode: 404,
        });
      }

      const { store: blobStore } = await app.getBlobStore();
      const buffer = await readStylePackLogo({
        uploadDir: app.env.STYLE_PACK_UPLOAD_DIR,
        blobKey: existing.logoBlobKey,
        blobStore,
      });
      if (!buffer) {
        throw new AppError({
          code: 'STYLE_PACK_LOGO_NOT_FOUND',
          message: 'Style pack logo not found',
          statusCode: 404,
        });
      }

      reply.header('Content-Type', existing.logoContentType);
      reply.header('Cache-Control', 'private, max-age=3600');
      return reply.send(buffer);
    },
  );

  app.post(
    '/api/v1/admin/doc-factory/style-packs/:id/preview-export',
    async (request, reply) => {
      assertMutatingOrigin(app, request);
      const principal = requireAuthenticated(request);
      requireSystemAdmin(principal);
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      const body = previewSchema.parse(request.body ?? {});

      const [existing] = await app.database.db
        .select()
        .from(stylePacks)
        .where(eq(stylePacks.id, params.id))
        .limit(1);
      if (!existing) {
        throw new AppError({
          code: 'STYLE_PACK_NOT_FOUND',
          message: 'Style pack not found',
          statusCode: 404,
        });
      }

      const { store: blobStore } = await app.getBlobStore();
      const { resolveExportStylePack } = await import('../lib/style-packs.js');
      const stylePack = await resolveExportStylePack({
        database: app.database,
        organizationId: existing.organizationId,
        stylePackId: existing.id,
        uploadDir: app.env.STYLE_PACK_UPLOAD_DIR,
        blobStore,
      });

      const {
        buildKnowledgeRecordDocx,
        buildKnowledgeRecordPdf,
        knowledgeExportContentType,
        knowledgeExportFilename,
      } = await import('../lib/knowledge-export.js');

      const exportInput = {
        title: 'Style pack preview',
        slug: 'style-pack-preview',
        summary: 'Fixed fixture used to preview Doc Factory style packs.',
        recordType: 'note',
        lifecycleStatus: 'draft',
        contentMarkdown: [
          '# Overview',
          '',
          'This preview validates **style pack** chrome on export.',
          '',
          '## Figures',
          '',
          '| Year | Amount |',
          '| --- | ---: |',
          '| 2024 | 12 |',
          '| 2025 | 18 |',
          '',
          '### Detail',
          '',
          '- Item one',
          '- Item two',
          '',
          '> Quoted note for chrome contrast.',
          '',
          '```ts',
          'const ready = true;',
          '```',
        ].join('\n'),
        exportedAt: new Date(),
        webUrl: app.env.WEB_URL,
        stylePack,
      };

      const bodyBuffer =
        body.format === 'pdf'
          ? await buildKnowledgeRecordPdf(exportInput)
          : await buildKnowledgeRecordDocx(exportInput);

      reply.header(
        'Content-Type',
        knowledgeExportContentType(body.format),
      );
      reply.header(
        'Content-Disposition',
        `attachment; filename="${knowledgeExportFilename(`preview-${existing.slug}`, body.format)}"`,
      );
      return reply.send(bodyBuffer);
    },
  );
}
