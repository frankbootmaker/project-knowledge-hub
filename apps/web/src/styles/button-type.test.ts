import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const webSrc = join(here, '..');

const CSS_FILES = ['ops-shell.css', 'landing.css', '../app/globals.css'] as const;

const SANS = "font-family: var(--font-sans), 'IBM Plex Sans', 'Segoe UI', sans-serif";

/** Button-like selectors. Word boundaries avoid matching `table` as `tab`. */
const CONTROL =
  /(?:^|[^\w-])button\b|\.kh-btn\b|toggle|cycle|pager|(?:^|[^\w-])tab\b|chip|\.kh-step\b/;

const CARD_FOOT_CONTROL =
  /card-foot[\s\S]*(?:button|\.kh-btn|\.kh-input|\binput\b|\bselect\b|\btextarea\b|page-num)/;

function source(relativePath: string): string {
  return readFileSync(join(here, relativePath), 'utf8');
}

function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  return match?.[1] ?? '';
}

function setsMono(body: string): boolean {
  return /(?:font-family|font)\s*:[^;]*mono/i.test(body);
}

function cssRules(css: string): Array<{ selector: string; body: string }> {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: Array<{ selector: string; body: string }> = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(stripped))) {
    const selector = match[1];
    const body = match[2];
    if (selector === undefined || body === undefined) continue;
    rules.push({ selector: selector.trim(), body });
  }
  return rules;
}

function isControlSelector(selector: string): boolean {
  return CONTROL.test(selector) || CARD_FOOT_CONTROL.test(selector);
}

function monoControlRules(css: string): string[] {
  return cssRules(css).flatMap(({ selector, body }) => {
    if (!setsMono(body)) return [];
    return selector
      .split(',')
      .map((part) => part.trim())
      .filter((part) => isControlSelector(part) && !/\.kh-ops-key-badge\b/.test(part))
      .map((part) => `${part} {${body.trim()}}`);
  });
}

function walkTsx(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      walkTsx(path, acc);
    } else if (path.endsWith('.tsx')) {
      acc.push(path);
    }
  }
  return acc;
}

function openingTags(fileSource: string, name: string): string[] {
  const tags: string[] = [];
  const re = new RegExp(`<${name}\\b`, 'g');
  let match: RegExpExecArray | null;
  while ((match = re.exec(fileSource))) {
    const start = match.index;
    let quote: '"' | "'" | '`' | null = null;
    let depth = 0;
    for (let i = start; i < fileSource.length; i += 1) {
      const ch = fileSource[i];
      if (quote) {
        if (ch === '\\') {
          i += 1;
          continue;
        }
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') {
        quote = ch;
        continue;
      }
      if (ch === '{') depth += 1;
      else if (ch === '}') depth = Math.max(0, depth - 1);
      else if (ch === '>' && depth === 0) {
        tags.push(fileSource.slice(start, i + 1));
        break;
      }
    }
  }
  return tags;
}

describe('buttons use the UI sans', () => {
  const shell = source('ops-shell.css');
  const landing = source('landing.css');
  const globals = source('../app/globals.css');

  it('keeps card-footer controls on the sidebar sans and captions mono', () => {
    const foot = ruleBody(shell, '.kh-ops-card-foot');
    expect(foot).toContain('font-family: var(--font-mono)');
    const controls = ruleBody(
      shell,
      '.kh-ops-card-foot\n  :is(button, .kh-btn, .kh-input, input, select, textarea, .kh-page-num, .kh-page-num-active):not(\n    .kh-ops-key-badge\n  )',
    );
    expect(controls).toContain(SANS);
    expect(controls).not.toMatch(/font-mono|monospace/);
  });

  it('uses sans on tree toggles, the editor toolbar, landing cycles, and step chips', () => {
    const toggle = ruleBody(shell, '.kh-ops-tree-toggle,\n.kh-ops-tree-spacer');
    expect(toggle).toContain(SANS);
    expect(toggle).not.toMatch(/font-mono|monospace/);

    const toolbar = ruleBody(shell, '.kh-ops-editor-toolbar button');
    expect(toolbar).toContain(SANS);
    expect(toolbar).not.toMatch(/font-mono|monospace/);

    const cycle = ruleBody(landing, '.kh-lp-cycle');
    expect(cycle).toContain('var(--font-sans)');
    expect(cycle).not.toMatch(/font-mono|monospace/);

    const step = ruleBody(globals, '.kh-step');
    expect(step).toContain('font-sans');
    expect(step).not.toMatch(/font-mono|monospace/);

    expect(globals).toContain('font-sans text-sm font-medium');
  });

  it('keeps monospace on item key badges', () => {
    expect(ruleBody(shell, '.kh-ops-key-badge')).toContain('font-family: var(--font-mono)');
    expect(ruleBody(shell, '.kh-ops-media-library .kh-ops-key-badge')).toContain(
      'font-family: var(--font-mono)',
    );
  });

  it('rejects a mono font on button, toggle, cycle, pager, tab, chip, or card-footer controls', () => {
    const offenders = CSS_FILES.flatMap((file) =>
      monoControlRules(source(file)).map((rule) => `${file}: ${rule}`),
    );
    expect(offenders).toEqual([]);
  });

  it('rejects font-mono on button, Button, and Link tags', () => {
    const offenders: string[] = [];
    for (const file of walkTsx(webSrc)) {
      const text = readFileSync(file, 'utf8');
      if (!text.includes('font-mono')) continue;
      for (const name of ['button', 'Button', 'Link', 'LinkButton'] as const) {
        for (const tag of openingTags(text, name)) {
          if (/\bfont-mono\b/.test(tag)) {
            offenders.push(`${file}: ${tag.replace(/\s+/g, ' ').slice(0, 180)}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
