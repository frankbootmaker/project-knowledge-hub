/**
 * @vitest-environment happy-dom
 */
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import de from '../../messages/de.json';
import en from '../../messages/en.json';
import hu from '../../messages/hu.json';
import { MarkdownDocument } from './MarkdownDocument';
import {
  readRelatedEntriesOpen,
  relatedEntriesOpenStorageKey,
  writeRelatedEntriesOpen,
} from '../lib/record-view-prefs';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const recordsEn = en.records;
const recordsHu = hu.records;
const recordsDe = de.records;

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: { count?: number }) => {
    const copy: Record<string, string> = {
      contents: recordsEn.contents,
      tocCollapse: recordsEn.tocCollapse,
      tocLabel: recordsEn.tocLabel,
      openWideViewer: recordsEn.openWideViewer,
      wideViewerTitle: recordsEn.wideViewerTitle,
      wideViewerDescription: recordsEn.wideViewerDescription,
      relatedEntriesToggle: recordsEn.relatedEntriesToggle,
      diagramRenderFailed: recordsEn.diagramRenderFailed,
    };
    const template = copy[key] ?? key;
    if (values?.count !== undefined) {
      return template.replace('{count}', String(values.count));
    }
    return template;
  },
}));

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async () => ({ svg: '<svg></svg>' })),
  },
}));

const mounted: Array<{ root: Root; container: HTMLDivElement }> = [];

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
  const buttons = Array.from(container.querySelectorAll('button'));
  const match = buttons.find((btn) => btn.textContent?.trim() === name);
  if (!match) {
    throw new Error(`Button not found: ${name}`);
  }
  return match;
}

describe('MarkdownDocument', () => {
  const toc = [{ id: 'intro', text: 'Intro', depth: 2 }];

  it('shows Contents label on the toc toggle when collapsed', () => {
    const container = render(
      <MarkdownDocument html="<p>Hi</p>" toc={toc} title="Doc" />,
    );
    const toggle = buttonNamed(container, recordsEn.contents);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-label')).toBe(recordsEn.tocLabel);
  });

  it('hides related entries toggle when count is zero', () => {
    const container = render(
      <MarkdownDocument html="<p>Hi</p>" toc={[]} title="Doc" />,
    );
    expect(
      container.textContent?.includes('Related entries'),
    ).toBe(false);
  });

  it('toggles related entries panel and persists open state', () => {
    let open = false;
    const onOpenChange = vi.fn((next: boolean) => {
      open = next;
      writeRelatedEntriesOpen(next);
    });

    const container = render(
      <MarkdownDocument
        html="<p>Hi</p>"
        toc={[]}
        title="Doc"
        relatedEntries={{
          count: 2,
          open,
          onOpenChange,
          panel: <div data-testid="related-panel">Related</div>,
        }}
      />,
    );

    const toggle = buttonNamed(container, 'Related entries (2)');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('[data-testid="related-panel"]')).toBeNull();

    click(toggle);
    expect(onOpenChange).toHaveBeenCalledWith(true);
    expect(readRelatedEntriesOpen()).toBe(true);

    act(() => {
      mounted[0]?.root.render(
        <MarkdownDocument
          html="<p>Hi</p>"
          toc={[]}
          title="Doc"
          relatedEntries={{
            count: 2,
            open: true,
            onOpenChange,
            panel: <div data-testid="related-panel">Related</div>,
          }}
        />,
      );
    });

    expect(
      container.querySelector('[data-testid="related-panel"]'),
    ).not.toBeNull();
    expect(buttonNamed(container, 'Related entries (2)').getAttribute('aria-expanded')).toBe(
      'true',
    );
  });

  it('restores related entries open state after reload', () => {
    localStorage.setItem(relatedEntriesOpenStorageKey, '1');
    expect(readRelatedEntriesOpen()).toBe(true);
  });
});

describe('records i18n labels (PRO-T-130)', () => {
  it('uses localized contents and related entries toggle strings', () => {
    expect(recordsEn.contents).toBe('Contents');
    expect(recordsHu.contents).toBe('Tartalomjegyzék');
    expect(recordsDe.contents).toBe('Inhaltsverzeichnis');
    expect(recordsEn.relatedEntriesToggle).toContain('{count}');
    expect(recordsHu.relatedEntriesToggle).toBe(
      'Kapcsolódó bejegyzések ({count})',
    );
    expect(recordsDe.relatedEntriesToggle).toBe(
      'Verwandte Einträge ({count})',
    );
  });
});
