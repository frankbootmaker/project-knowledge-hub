/**
 * @vitest-environment happy-dom
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import de from '../../messages/de.json';
import en from '../../messages/en.json';
import hu from '../../messages/hu.json';
import {
  DESCRIPTION_MARKDOWN_MODE_KEY,
  DescriptionMarkdownField,
} from './DescriptionMarkdownField';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => {
    const copy: Record<string, string> = {
      descriptionRaw: 'Raw',
      descriptionRendered: 'Rendered',
      descriptionView: 'Description view',
      diagramRenderFailed: 'Diagram failed',
    };
    return copy[key] ?? key;
  },
}));

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async () => ({ svg: '<svg class="kh-test-mermaid"></svg>' })),
  },
}));

const here = dirname(fileURLToPath(import.meta.url));
const mounted: Array<{ root: Root; container: HTMLDivElement }> = [];

const SAMPLE = [
  '**Hello**',
  '',
  '- one',
  '- [x] done',
  '',
  '| A | B |',
  '| - | - |',
  '| 1 | 2 |',
  '',
  '```ts',
  'const x = 1;',
  '```',
  '',
  '```mermaid',
  'graph TD',
  '  A-->B',
  '```',
  '',
  '[site](https://example.com/docs)',
  '',
  '<script>alert(1)</script>',
  '',
  '[bad](javascript:alert(1))',
].join('\n');

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    act(() => {
      entry.root.unmount();
    });
    entry.container.remove();
  }
});

function render(node: ReactNode): HTMLDivElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(node);
  });
  mounted.push({ root, container });
  return container;
}

function click(element: Element | null | undefined) {
  act(() => {
    element?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function buttonNamed(container: ParentNode, name: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find(
    (item) => item.textContent === name,
  );
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`missing ${name}`);
  }
  return button;
}

async function waitForMarkdown(container: ParentNode) {
  const started = Date.now();
  while (!container.querySelector('.knowledge-markdown')) {
    if (Date.now() - started > 2000) {
      throw new Error('markdown not rendered');
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
}

function Harness({
  initial,
  readOnly = false,
  label = 'Description',
}: {
  initial: string;
  readOnly?: boolean;
  label?: string;
}) {
  const [value, setValue] = useState(initial);
  return (
    <DescriptionMarkdownField label={label} value={value} onChange={setValue} readOnly={readOnly} />
  );
}

describe('DescriptionMarkdownField', () => {
  it('hides the toggle and keeps a textarea when the description is empty', () => {
    const container = render(<Harness initial="   " />);
    expect(container.querySelector('[role="group"]')).toBeNull();
    expect(container.querySelector('textarea')).not.toBeNull();
    expect(container.querySelector('.knowledge-markdown')).toBeNull();
  });

  it('renders GFM by default and strips raw HTML and unsafe links', async () => {
    const container = render(<Harness initial={SAMPLE} />);
    await waitForMarkdown(container);
    const view = container.querySelector('.knowledge-markdown');
    expect(view?.querySelector('strong')?.textContent).toBe('Hello');
    expect(view?.querySelector('li')?.textContent).toContain('one');
    expect(view?.querySelector('table')).not.toBeNull();
    expect(view?.querySelector('input[type="checkbox"]')).not.toBeNull();
    expect(view?.querySelector('pre code')?.textContent).toContain('const x = 1;');
    const link = view?.querySelector('a');
    expect(link?.getAttribute('href')).toBe('https://example.com/docs');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toContain('noopener');
    expect(view?.innerHTML.toLowerCase()).not.toContain('<script');
    expect(view?.innerHTML.toLowerCase()).not.toContain('javascript:');
    expect(buttonNamed(container, 'Rendered').getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('textarea')).toBeNull();
  });

  it('draws mermaid through the knowledge renderer', async () => {
    const container = render(<Harness initial={'```mermaid\ngraph TD\n  A-->B\n```'} />);
    const started = Date.now();
    while (!container.querySelector('.kh-test-mermaid, pre.mermaid')) {
      if (Date.now() - started > 2000) {
        throw new Error('mermaid missing');
      }
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    }
  });

  it('switches to a plain textarea and remembers the choice', async () => {
    const container = render(<Harness initial={SAMPLE} />);
    await waitForMarkdown(container);
    click(buttonNamed(container, 'Raw'));
    const textarea = container.querySelector('textarea');
    expect(textarea?.value).toBe(SAMPLE);
    expect(textarea?.className).not.toContain('kh-ops-markdown-editor');
    expect(localStorage.getItem(DESCRIPTION_MARKDOWN_MODE_KEY)).toBe('raw');
    expect(buttonNamed(container, 'Raw').getAttribute('aria-pressed')).toBe('true');

    const again = render(<Harness initial="**Stay raw**" />);
    expect(again.querySelector('textarea')?.value).toBe('**Stay raw**');
    expect(again.querySelector('.knowledge-markdown')).toBeNull();

    click(buttonNamed(again, 'Rendered'));
    await waitForMarkdown(again);
    expect(localStorage.getItem(DESCRIPTION_MARKDOWN_MODE_KEY)).toBe('rendered');
    expect(again.querySelector('textarea')).toBeNull();
  });

  it('keeps the textarea while typing into an empty field', () => {
    const container = render(<Harness initial="" />);
    const textarea = container.querySelector('textarea');
    if (!(textarea instanceof HTMLTextAreaElement)) {
      throw new Error('missing textarea');
    }
    act(() => {
      textarea.focus();
    });
    act(() => {
      const proto = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
      proto?.set?.call(textarea, '**Hi**');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(container.querySelector('textarea')).toBe(textarea);
    expect(container.querySelector('[role="group"]')).not.toBeNull();
    expect(container.querySelector('.knowledge-markdown')).toBeNull();
  });

  it('shows read-only raw text without a textarea', async () => {
    const container = render(<Harness initial="**Hello**" readOnly />);
    await waitForMarkdown(container);
    expect(container.querySelector('textarea')).toBeNull();
    click(buttonNamed(container, 'Raw'));
    const raw = container.querySelector('pre.kh-ops-description-raw');
    expect(raw?.textContent).toBe('**Hello**');
    expect(container.querySelector('textarea')).toBeNull();
  });
});

describe('description markdown copy and wiring', () => {
  it('translates the toggle in English, German, and Hungarian', () => {
    expect(en.delivery.descriptionRaw).toBe('Raw');
    expect(en.delivery.descriptionRendered).toBe('Rendered');
    expect(en.delivery.descriptionView).toBe('Description view');
    expect(de.delivery.descriptionRaw).toBe('Rohtext');
    expect(de.delivery.descriptionRendered).toBe('Darstellung');
    expect(de.delivery.descriptionView).toBe('Beschreibungsansicht');
    expect(hu.delivery.descriptionRaw).toBe('Nyers');
    expect(hu.delivery.descriptionRendered).toBe('Megjelenített');
    expect(hu.delivery.descriptionView).toBe('Leírás nézete');
  });

  it('uses the view on epic, story, task, and bug fields only', () => {
    const task = readFileSync(join(here, 'ProjectTaskManageModal.tsx'), 'utf8');
    const agile = readFileSync(join(here, 'ProjectAgileManageModal.tsx'), 'utf8');
    expect(task.split('<DescriptionMarkdownField').length - 1).toBe(4);
    expect(task).toContain("label={t('description')}");
    expect(task).toContain("label={t('stepsToReproduce')}");
    expect(task).toContain("label={t('expectedBehavior')}");
    expect(task).toContain("label={t('actualBehavior')}");
    expect(task).toContain('whitespace-pre-wrap');
    expect(agile.split('<DescriptionMarkdownField').length - 1).toBe(1);
    expect(agile).toContain("kind === 'milestone'");
    expect(agile).toContain("label={t('milestoneNote')}");
    expect(agile).toContain('<Textarea');
  });

  it('keeps the UI sans on the view and mono inside code', () => {
    const shell = readFileSync(join(here, '../styles/ops-shell.css'), 'utf8');
    const rawAt = shell.indexOf('.kh-ops-description-raw {');
    const rawBlock = shell.slice(rawAt, rawAt + 420);
    expect(rawBlock).toContain('font-sans');
    expect(rawBlock).not.toContain('font-mono');
    const codeAt = shell.indexOf('.kh-ops-description-markdown .knowledge-markdown :is(pre, code)');
    expect(shell.slice(codeAt, codeAt + 180)).toContain('font-mono');
    const globals = readFileSync(join(here, '../app/globals.css'), 'utf8');
    expect(globals).toContain('.knowledge-markdown code {');
    expect(globals).toContain('contains-task-list');
  });
});
