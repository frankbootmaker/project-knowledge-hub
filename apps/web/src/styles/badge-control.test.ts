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

describe('toolbar badge height matches buttons', () => {
  const tokens = source('tokens.css');
  const globals = source('../app/globals.css');
  const badge = source('../components/ui/Badge.tsx');

  it('defines --kh-button-height from control padding', () => {
    expect(tokens).toContain(
      '--kh-button-height: calc(2 * var(--kh-control-pad-y) + 1.25rem + 2px);',
    );
  });

  it('maps matchControlHeight to kh-badge-control', () => {
    expect(badge).toContain("matchControlHeight ? 'kh-badge-control py-0'");
  });

  it('uses the button height token on kh-badge-control without button padding', () => {
    const body = ruleBody(globals, '.kh-badge-control');
    expect(body).toContain('min-height: var(--kh-button-height);');
    expect(body).not.toContain('padding-inline');
    expect(body).not.toContain('padding-block');
  });

  it('keeps compact badge padding when matchControlHeight is enabled', () => {
    expect(badge).toContain("'kh-badge-control py-0'");
    expect(badge).toContain('px-1.5');
  });
});
