import { z } from 'zod';

/** Curated accent palette for workspace tiles (avoid purple/glow defaults). */
export const WORKSPACE_COLORS = [
  'ocean',
  'teal',
  'forest',
  'moss',
  'amber',
  'copper',
  'coral',
  'rose',
  'slate',
  'ink',
] as const;

export type WorkspaceColor = (typeof WORKSPACE_COLORS)[number];

export const workspaceColorSchema = z.enum(WORKSPACE_COLORS);

/** Prefer stored color; otherwise pick a stable palette entry from a seed (id/slug). */
export function resolveWorkspaceColor(
  color: string | null | undefined,
  seed: string,
): WorkspaceColor {
  const parsed = workspaceColorSchema.safeParse(color);
  if (parsed.success) {
    return parsed.data;
  }
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return WORKSPACE_COLORS[hash % WORKSPACE_COLORS.length]!;
}
