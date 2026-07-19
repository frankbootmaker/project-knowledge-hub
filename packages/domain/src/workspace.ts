import { z } from 'zod';

/** Brief overview length for workspace description (UI + API). */
export const WORKSPACE_DESCRIPTION_MAX_LENGTH = 280;

export const workspaceDescriptionSchema = z
  .string()
  .max(WORKSPACE_DESCRIPTION_MAX_LENGTH);
