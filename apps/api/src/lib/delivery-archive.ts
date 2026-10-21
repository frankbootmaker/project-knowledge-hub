import type { Database } from '@project-knowledge-hub/database';
import {
  AppError,
  archivedItemLinkMessage,
  formatHumanKey,
  type ArchivedLinkKind,
} from '@project-knowledge-hub/domain';
import { getProjectKeyPrefix } from './project-issue-keys.js';

const ARCHIVED_LINK_CODE: Record<ArchivedLinkKind, string> = {
  milestone: 'MILESTONE_ARCHIVED',
  epic: 'EPIC_ARCHIVED',
  user_story: 'USER_STORY_ARCHIVED',
  sprint: 'SPRINT_ARCHIVED',
};

export async function deliveryKeyLabel(
  database: Database,
  projectId: string,
  issueKeyType: string | null,
  issueNumber: number | null,
  fallback: string,
): Promise<string> {
  const prefix = await getProjectKeyPrefix(database, projectId);
  return formatHumanKey(prefix, issueKeyType, issueNumber) ?? fallback;
}

export function archivedDeliveryLinkError(kind: ArchivedLinkKind, label: string): AppError {
  return new AppError({
    code: ARCHIVED_LINK_CODE[kind],
    message: archivedItemLinkMessage(kind, label),
    statusCode: 409,
  });
}
