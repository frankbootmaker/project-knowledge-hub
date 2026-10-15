import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

function source(relativePath: string): string {
  return readFileSync(join(here, relativePath), 'utf8');
}

function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  return match?.[1] ?? '';
}

const MENU = [
  'font-family: var(--font-sans)',
  'font-size: 13px',
  'font-weight: 400',
  'letter-spacing: normal',
  'text-transform: none',
] as const;

describe('kicker labels use the rail menu type', () => {
  const css = source('ops-shell.css');
  const board = source('../components/ProjectDeliveryBoard.tsx');
  const search = source('../app/(app)/search/page.tsx');

  it.each([
    '.kh-ops-eyebrow',
    '.kh-ops-subtitle',
    '.kh-ops-crumb',
    '.kh-ops-stat-label',
    '.kh-ops-count-item small',
    '.kh-ops-lane-count',
    '.kh-ops-tag',
    '.kh-ops-mode-copy {\n  margin-top: 9px;\n}',
  ])('%s is not a mono cap', (selector) => {
    if (selector.startsWith('.kh-ops-mode-copy {')) {
      expect(css).toContain(selector);
      const label = ruleBody(css, '.kh-ops-workspace-select small,\n.kh-ops-mode-copy');
      for (const token of MENU) expect(label).toContain(token);
      expect(label).not.toContain('font-mono');
      return;
    }
    const body = ruleBody(css, selector);
    for (const token of MENU) expect(body).toContain(token);
    expect(body).not.toContain('font-mono');
  });

  it('keeps monospace on key badges and splits bug kind from the key', () => {
    expect(ruleBody(css, '.kh-ops-key-badge')).toContain('font-family: var(--font-mono)');
    expect(board).toContain('<WorkItemIdLine');
    expect(board).not.toContain('kh-ops-task-id');
  });

  it('renders search titles as link buttons and group headings in the menu type', () => {
    expect(search).toContain('<LinkButton');
    expect(search).not.toContain('<Link ');
    const heading = ruleBody(css, '.kh-ops-search-group .kh-ops-panel-title');
    for (const token of MENU) expect(heading).toContain(token);
  });
});
