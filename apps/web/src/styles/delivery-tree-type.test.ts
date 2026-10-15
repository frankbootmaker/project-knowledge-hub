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

describe('delivery tree type matches the list', () => {
  const css = source('ops-shell.css');
  const tree = source('../components/ProjectDeliveryTree.tsx');

  it('shares the table header label with the tree header', () => {
    const header = ruleBody(
      css,
      '.kh-ops-data-table th,\n.kh-ops-delivery-tree-head,\n.kh-ops-delivery-tree-head-meta > span',
    );
    expect(header).toContain('font-family: var(--font-sans)');
    expect(header).toContain('font-size: 13px');
    expect(header).toContain('font-weight: 400');
    expect(header).toContain('letter-spacing: normal');
    expect(header).toContain('line-height: 1.45');
    expect(header).toContain('text-transform: none');
  });

  it('shares body, title, and number type with the list cells', () => {
    const body = ruleBody(css, '.kh-ops-data-table td,\n.kh-ops-tree-meta > .kh-ops-tree-cell');
    expect(body).toContain('font-family: var(--font-sans)');
    expect(body).toContain('font-size: 13px');
    expect(body).toContain('font-weight: 400');
    expect(body).toContain('line-height: 1.45');

    const title = ruleBody(
      css,
      '.kh-ops-data-table .kh-ops-primary-cell,\n.kh-ops-tree-title .kh-ops-primary-cell',
    );
    expect(title).toContain('font-family: var(--font-sans)');
    expect(title).toContain('font-size: 13px');
    expect(title).toContain('font-weight: 400');
    expect(title).toContain('line-height: 1.45');

    const number = ruleBody(
      css,
      '.kh-ops-data-table .kh-ops-num,\n.kh-ops-tree-meta > .kh-ops-tree-cell.kh-ops-num',
    );
    expect(number).toContain('font-family: var(--font-sans)');
    expect(number).toContain('font-size: 13px');
    expect(number).toContain('font-weight: 400');
    expect(number).toContain('line-height: 1.45');
    expect(number).toContain('font-variant-numeric: tabular-nums');
  });

  it('keeps monospace on item key badges only', () => {
    const key = ruleBody(css, '.kh-ops-key-badge');
    expect(key).toContain('font-family: var(--font-mono)');
    expect(tree).toContain('DeliveryItemIdButton');
    expect(tree).toContain("variant={subIsKey ? 'key' : 'type'}");
  });

  it('marks tree title, key, status, and percent with the list classes', () => {
    expect(tree).toContain('className="kh-ops-primary-cell"');
    expect(tree).toContain('kh-ops-type-chip');
    expect(tree).toContain('kh-ops-tree-cell kh-ops-tree-status');
    expect(tree).toContain('kh-ops-tree-cell kh-ops-num kh-ops-tree-pct');
    expect(tree).not.toContain('<small>');
  });
});
