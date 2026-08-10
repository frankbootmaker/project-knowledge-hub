import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { users, workspaces } from '@project-knowledge-hub/database';
import { AppError, appLocaleSchema } from '@project-knowledge-hub/domain';
import { requireWorkspaceView } from '@project-knowledge-hub/permissions';
import {
  assertMutatingOrigin,
  requireAuthenticated,
} from '../plugins/auth.js';
import { writeAuditEvent } from '../lib/identity.js';
import { requireProjectContext } from '../lib/project-delivery.js';

const exportBodySchema = z.object({
  title: z.string().min(1).max(300),
  markdown: z.string().min(1).max(500_000),
  format: z.enum(['pdf', 'md']),
  kind: z.enum(['delivery', 'stakeholders', 'status']).optional(),
  locale: appLocaleSchema.optional(),
});

function stripLeadingH1(markdown: string): string {
  return markdown.replace(/^#\s+[^\n]+\n+/, '');
}

export async function registerProjectReportRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.post('/api/v1/projects/:projectId/reports/export', async (request, reply) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    const params = z.object({ projectId: z.string().uuid() }).parse(request.params);
    const body = exportBodySchema.parse(request.body);

    const { project } = await requireProjectContext(app.database, params.projectId);
    requireWorkspaceView(principal, project.workspaceId);

    const {
      buildKnowledgeMarkdownExport,
      buildKnowledgeRecordPdf,
      knowledgeExportContentType,
      knowledgeExportFilename,
    } = await import('../lib/knowledge-export.js');

    let locale = body.locale;
    if (!locale) {
      const [user] = await app.database.db
        .select({ preferredLocale: users.preferredLocale })
        .from(users)
        .where(eq(users.id, principal.userId))
        .limit(1);
      locale = appLocaleSchema.catch('en').parse(user?.preferredLocale);
    }

    const contentMarkdown = stripLeadingH1(body.markdown);
    const exportInput = {
      title: body.title,
      slug: `${project.slug}-${body.kind ?? 'report'}`,
      summary: project.summary,
      recordType: 'progress-summary',
      lifecycleStatus: 'current',
      contentMarkdown,
      exportedAt: new Date(),
      locale,
      webUrl: app.env.WEB_URL,
      cookieHeader:
        typeof request.headers.cookie === 'string' ? request.headers.cookie : null,
      stylePack: null,
    };

    let fileBody: Buffer | string;
    try {
      if (body.format === 'md') {
        fileBody = buildKnowledgeMarkdownExport(exportInput);
      } else {
        fileBody = await buildKnowledgeRecordPdf(exportInput);
      }
    } catch (error) {
      throw new AppError({
        code: 'PROJECT_REPORT_EXPORT_FAILED',
        message:
          error instanceof Error ? error.message : 'Failed to export project report',
        statusCode: 500,
      });
    }

    const [workspace] = await app.database.db
      .select({ organizationId: workspaces.organizationId })
      .from(workspaces)
      .where(eq(workspaces.id, project.workspaceId))
      .limit(1);

    await writeAuditEvent(app.database, {
      organizationId: workspace?.organizationId ?? null,
      actorType: 'user',
      actorId: principal.userId,
      action: 'project.report_exported',
      entityType: 'project',
      entityId: project.id,
      metadata: {
        format: body.format,
        kind: body.kind ?? null,
        title: body.title,
      },
      ipAddress: request.ip,
    });

    const filename = knowledgeExportFilename(exportInput.slug, body.format);
    reply
      .header('Content-Type', knowledgeExportContentType(body.format))
      .header(
        'Content-Disposition',
        `attachment; filename="${filename.replace(/"/g, '')}"`,
      );
    return reply.send(fileBody);
  });
}
