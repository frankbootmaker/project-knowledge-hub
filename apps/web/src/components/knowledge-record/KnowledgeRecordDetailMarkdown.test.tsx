/**
 * @vitest-environment happy-dom
 */
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { relatedEntriesOpenStorageKey } from '../../lib/record-view-prefs';
import { KnowledgeRecordDetailMarkdown } from './KnowledgeRecordDetailMarkdown';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: { count?: number }) => {
    if (key === 'relatedEntriesToggle' && values?.count !== undefined) {
      return `Related entries (${values.count})`;
    }
    const copy: Record<string, string> = {
      contents: 'Contents',
      tocCollapse: 'Hide contents',
      tocLabel: 'Table of contents',
      openWideViewer: 'Open wide viewer',
      wideViewerTitle: 'Document viewer',
      wideViewerDescription: 'Wide viewer',
      diagramRenderFailed: 'Diagram failed',
    };
    return copy[key] ?? key;
  },
}));

vi.mock('./KnowledgeRecordRelationsPanel', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('./KnowledgeRecordRelationsPanel')
  >();
  return {
    ...actual,
    KnowledgeRecordRelationsPanel: () => (
      <div data-testid="relations-panel">Relations</div>
    ),
  };
});

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async () => ({ svg: '<svg></svg>' })),
  },
}));

const mounted: Array<{ root: Root; container: HTMLDivElement }> = [];

const relations = {
  relations: {
    outbound: [
      {
        relationType: 'relates_to',
        record: {
          id: 'r1',
          humanKey: 'K-1',
          title: 'One',
          slug: 'one',
          recordType: 'note',
          lifecycleStatus: 'draft',
          archivedAt: null,
        },
      },
    ],
    inbound: [],
  },
  lifecycleSuccessor: null,
  lifecyclePredecessor: null,
};

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

describe('KnowledgeRecordDetailMarkdown', () => {
  it('restores related entries open state from localStorage after mount', async () => {
    localStorage.setItem(relatedEntriesOpenStorageKey, '1');
    const container = render(
      <KnowledgeRecordDetailMarkdown
        html="<p>Body</p>"
        toc={[]}
        title="Doc"
        recordId="rec"
        projectId={null}
        canEditRelations={false}
        relations={relations}
        catalogue={[]}
      />,
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="relations-panel"]')).not.toBeNull();
    const toggle = Array.from(container.querySelectorAll('button')).find((btn) =>
      btn.textContent?.includes('Related entries (1)'),
    );
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
  });
});
