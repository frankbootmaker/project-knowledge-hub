import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function fallbacks(source: string): string[] {
  return source.match(/fallback=\{[^}]*\}/g) ?? [];
}

describe('app shell suspense', () => {
  it('does not render the page inside a suspense fallback', () => {
    const root = join(process.cwd(), 'src');
    const layout = readFileSync(join(root, 'app/(app)/layout.tsx'), 'utf8');
    const shell = readFileSync(join(root, 'components/ops/OpsAppShell.tsx'), 'utf8');
    const rendered = [...fallbacks(layout), ...fallbacks(shell)].join('\n');
    expect(rendered).not.toContain('children');
    expect(layout).not.toContain('min-h-screen">{children}');
  });
});
