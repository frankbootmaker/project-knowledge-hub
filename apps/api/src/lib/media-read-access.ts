import { AppError } from '@project-knowledge-hub/domain';

/** Shown on media links and list rows so clients know which tool reads pixels. */
export const WORKSPACE_MEDIA_READ_HINT = 'Use get_workspace_media with mediaId to read the image.';

export type MediaReadClient = {
  organizationId: string;
  allowedWorkspaceIds: string[];
};

export type MediaReadWorkspace = {
  id: string;
  organizationId: string;
};

/**
 * MCP read access for one media row.
 * Same organization is required. A non-empty workspace allow-list must include
 * the media workspace. An empty allow-list can read every workspace in the org,
 * matching other knowledge:read tools.
 */
export function assertClientCanReadMediaWorkspace(
  client: MediaReadClient,
  workspace: MediaReadWorkspace,
): void {
  const sameOrg = workspace.organizationId === client.organizationId;
  const allowlist = client.allowedWorkspaceIds;
  const onAllowlist = allowlist.length === 0 || allowlist.includes(workspace.id);
  if (!sameOrg || !onAllowlist) {
    throw new AppError({
      code: 'FORBIDDEN',
      message: 'You do not have access to this media',
      statusCode: 403,
    });
  }
}
