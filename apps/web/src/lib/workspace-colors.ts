import {
  resolveWorkspaceColor,
  WORKSPACE_COLORS,
  type WorkspaceColor,
} from '@project-knowledge-hub/domain';

export { WORKSPACE_COLORS, resolveWorkspaceColor, type WorkspaceColor };

export function workspaceAccentClassName(
  color: string | null | undefined,
  seed: string,
): string {
  return `kh-workspace-color-${resolveWorkspaceColor(color, seed)}`;
}

export function workspaceTileClassName(
  color: string | null | undefined,
  seed: string,
): string {
  return `kh-workspace-tile ${workspaceAccentClassName(color, seed)}`;
}

export function workspaceSwatchClassName(color: WorkspaceColor): string {
  return `kh-workspace-swatch kh-workspace-color-${color}`;
}
