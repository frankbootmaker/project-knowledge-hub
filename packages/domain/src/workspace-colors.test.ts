import { describe, expect, it } from 'vitest';
import { resolveWorkspaceColor, WORKSPACE_COLORS } from './workspace-colors.js';

describe('resolveWorkspaceColor', () => {
  it('returns stored palette colors', () => {
    expect(resolveWorkspaceColor('coral', 'x')).toBe('coral');
  });

  it('falls back to a stable hash color', () => {
    const a = resolveWorkspaceColor(null, 'workspace-a');
    const b = resolveWorkspaceColor(null, 'workspace-a');
    const c = resolveWorkspaceColor(undefined, 'workspace-b');
    expect(a).toBe(b);
    expect(WORKSPACE_COLORS).toContain(a);
    expect(WORKSPACE_COLORS).toContain(c);
  });
});
