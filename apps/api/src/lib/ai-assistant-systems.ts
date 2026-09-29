import { eq } from 'drizzle-orm';
import type { Database } from '@project-knowledge-hub/database';
import { systems } from '@project-knowledge-hub/database';
import { AppError } from '@project-knowledge-hub/domain';

/** Catalogue systems with this type appear as AI-assistant stakeholders (not general Systems). */
export const AI_ASSISTANT_SYSTEM_TYPE = 'ai_assistant';

/**
 * Validates that the given systemId is an AI assistant linked to the project.
 * Throws an AppError with error order that avoids leaking information:
 * - 404 SYSTEM_NOT_FOUND: system doesn't exist, is archived, or is in a different workspace
 * - 400 SYSTEM_NOT_AI_ASSISTANT: system exists in workspace but is not an AI assistant
 * - 400 AI_SYSTEM_NOT_IN_PROJECT: AI assistant exists in workspace but not linked to this project
 * Returns the system record if valid.
 */
export async function assertAiAssistantForProject(
  database: Database,
  projectId: string,
  projectWorkspaceId: string,
  systemId: string,
): Promise<typeof systems.$inferSelect> {
  const [system] = await database.db
    .select()
    .from(systems)
    .where(eq(systems.id, systemId))
    .limit(1);

  if (
    !system ||
    system.archivedAt ||
    system.workspaceId !== projectWorkspaceId
  ) {
    throw new AppError({
      code: 'SYSTEM_NOT_FOUND',
      message: 'AI assistant system not found',
      statusCode: 404,
    });
  }

  if (system.systemType !== AI_ASSISTANT_SYSTEM_TYPE) {
    throw new AppError({
      code: 'SYSTEM_NOT_AI_ASSISTANT',
      message: 'System is not an AI assistant',
      statusCode: 400,
    });
  }

  if (system.projectId !== projectId) {
    throw new AppError({
      code: 'AI_SYSTEM_NOT_IN_PROJECT',
      message: 'AI assistant is not linked to this project',
      statusCode: 400,
    });
  }

  return system;
}
