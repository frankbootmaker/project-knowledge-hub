import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { workspaces } from '@project-knowledge-hub/database';
import {
  ALLOWED_MEDIA_TYPES,
  itemMediaEntityTypeSchema,
} from '@project-knowledge-hub/domain';
import {
  requireSystemAdmin,
  requireWorkspaceMaintainer,
  requireWorkspaceView,
} from '@project-knowledge-hub/permissions';
import {
  assertMutatingOrigin,
  requireAuthenticated,
} from '../plugins/auth.js';
import { getDefaultOrganization, writeAuditEvent } from '../lib/identity.js';
import {
  getEffectiveMediaMaxBytes,
  setMediaMaxBytes,
} from '../lib/media-max-bytes.js';
import {
  assertProjectNotArchived,
  requireProjectContext,
} from '../lib/project-delivery.js';
import {
  listItemMediaLinks,
  setItemMediaLinks,
} from '../lib/project-item-media.js';

const linkSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('media'),
    mediaId: z.string().uuid(),
    title: z.string().max(200).nullable().optional(),
    description: z.string().max(2000).nullable().optional(),
  }),
  z.object({
    kind: z.literal('url'),
    url: z.string().min(1).max(2000),
    title: z.string().min(1).max(200),
    description: z.string().max(2000).nullable().optional(),
  }),
]);

async function workspaceOrgId(
  app: FastifyInstance,
  workspaceId: string,
): Promise<string | null> {
  const [workspace] = await app.database.db
    .select({ organizationId: workspaces.organizationId })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  return workspace?.organizationId ?? null;
}

export async function registerProjectItemMediaRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get(
    '/api/v1/projects/:projectId/item-media-links',
    async (request) => {
      const principal = requireAuthenticated(request);
      const params = z
        .object({ projectId: z.string().uuid() })
        .parse(request.params);
      const query = z
        .object({
          entityType: itemMediaEntityTypeSchema,
          entityId: z.string().uuid(),
        })
        .parse(request.query);
      const { project } = await requireProjectContext(app.database, params.projectId);
      requireWorkspaceView(principal, project.workspaceId);
      const mediaLinks = await listItemMediaLinks(app.database, query);
      return { mediaLinks };
    },
  );

  app.put(
    '/api/v1/projects/:projectId/item-media-links',
    async (request) => {
      assertMutatingOrigin(app, request);
      const principal = requireAuthenticated(request);
      const params = z
        .object({ projectId: z.string().uuid() })
        .parse(request.params);
      const body = z
        .object({
          entityType: itemMediaEntityTypeSchema,
          entityId: z.string().uuid(),
          links: z.array(linkSchema).max(100),
        })
        .parse(request.body);
      const { project } = await requireProjectContext(app.database, params.projectId);
      requireWorkspaceMaintainer(principal, project.workspaceId);
      assertProjectNotArchived(project);
      const mediaLinks = await setItemMediaLinks(app.database, {
        projectId: project.id,
        entityType: body.entityType,
        entityId: body.entityId,
        links: body.links.map((link) =>
          link.kind === 'media'
            ? {
                kind: 'media' as const,
                mediaId: link.mediaId,
                title: link.title,
                description: link.description,
              }
            : {
                kind: 'url' as const,
                url: link.url,
                title: link.title,
                description: link.description,
              },
        ),
        createdBy: principal.userId,
      });
      await writeAuditEvent(app.database, {
        organizationId: await workspaceOrgId(app, project.workspaceId),
        actorType: 'user',
        actorId: principal.userId,
        action: 'project.item_media_links_set',
        entityType: body.entityType,
        entityId: body.entityId,
        metadata: { projectId: project.id, linkCount: mediaLinks.length },
        ipAddress: request.ip,
      });
      return { mediaLinks };
    },
  );
}

export async function registerMediaLibrarySettingsRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get('/api/v1/admin/media-library-settings', async (request) => {
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);
    const ceilingBytes = app.env.MEDIA_MAX_BYTES;
    const maxBytes = await getEffectiveMediaMaxBytes(app.database, ceilingBytes);
    return {
      settings: {
        allowedTypes: [...ALLOWED_MEDIA_TYPES],
        maxBytes,
        ceilingBytes,
      },
    };
  });

  app.put('/api/v1/admin/media-library-settings', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);
    const body = z
      .object({ maxBytes: z.number().int().positive() })
      .parse(request.body);
    const ceilingBytes = app.env.MEDIA_MAX_BYTES;
    const maxBytes = await setMediaMaxBytes(app.database, {
      maxBytes: body.maxBytes,
      ceiling: ceilingBytes,
      updatedBy: principal.userId,
    });
    const organization = await getDefaultOrganization(app.database);
    await writeAuditEvent(app.database, {
      organizationId: organization?.id ?? null,
      actorType: 'user',
      actorId: principal.userId,
      action: 'media.library_settings_update',
      entityType: 'platform_settings',
      entityId: 'media_max_bytes',
      metadata: { maxBytes, ceilingBytes },
      ipAddress: request.ip,
    });
    return {
      settings: {
        allowedTypes: [...ALLOWED_MEDIA_TYPES],
        maxBytes,
        ceilingBytes,
      },
    };
  });
}
