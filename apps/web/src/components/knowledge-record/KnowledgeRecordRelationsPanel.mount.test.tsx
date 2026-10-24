/**
 * @vitest-environment happy-dom
 */
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../ui';
import { KnowledgeRecordRelationsPanel } from './KnowledgeRecordRelationsPanel';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../LinkedKnowledgeRecord', () => ({
  LinkedKnowledgeRecord: ({ title }: { title: string }) => title,
}));

vi.mock('next-intl', () => ({
  useTranslations: () => {
    const t = (key: string, values?: { from?: number; to?: number; total?: number; count?: number }) => {
      if (key === 'documentsShowing') {
        return `Showing ${values?.from}–${values?.to} of ${values?.total}`;
      }
      if (key === 'documentsPageSizeOption') {
        return `${values?.count} per page`;
      }
      return key;
    };
    t.has = () => false;
    return t;
  },
}));

const workspaceId = '11111111-1111-4111-8111-111111111111';
const recordId = '22222222-2222-4222-8222-222222222222';
const projectId = '33333333-3333-4333-8333-333333333333';
const alphaId = '44444444-4444-4444-8444-444444444444';
const pageTwoId = '55555555-5555-4555-8555-555555555555';
const planId = '66666666-6666-4666-8666-666666666666';
const linkedId = '77777777-7777-4777-8777-777777777777';

const mounted: Array<{ root: Root; container: HTMLDivElement }> = [];

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    act(() => {
      entry.root.unmount();
    });
    entry.container.remove();
  }
  vi.unstubAllGlobals();
});

function render(node: ReactNode): HTMLDivElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<ToastProvider>{node}</ToastProvider>);
  });
  mounted.push({ root, container });
  return container;
}

function clickButton(label: string, root: ParentNode = document.body) {
  const button = Array.from(root.querySelectorAll('button')).find(
    (element) => element.textContent === label,
  );
  if (!button) {
    throw new Error(`Missing button ${label}`);
  }
  act(() => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

async function settle(fetchMock: ReturnType<typeof vi.fn>) {
  await act(async () => {
    const pending = fetchMock.mock.results.map((result) => result.value as Promise<unknown>);
    await Promise.all(pending);
  });
  await act(async () => {
    await Promise.resolve();
  });
}

const emptyRelations = {
  relations: { outbound: [], inbound: [] },
  lifecycleSuccessor: null,
  lifecyclePredecessor: null,
};

describe('KnowledgeRecordRelationsPanel picker', () => {
  it('loads project candidates only after the picker opens, then pages, searches, and saves', async () => {
    const savedLinks: unknown[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost');
      if (init?.method === 'PUT') {
        savedLinks.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify({
          relations: {
            outbound: [{
              relationType: 'relates_to',
              record: {
                id: planId,
                humanKey: 'PRJ-NT-3',
                title: 'Plan note',
                slug: 'plan-note',
                recordType: 'note',
                lifecycleStatus: 'draft',
                archivedAt: null,
              },
            }],
            inbound: [],
          },
          lifecycleSuccessor: null,
          lifecyclePredecessor: null,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      const q = url.searchParams.get('q');
      const offset = Number(url.searchParams.get('offset') ?? '0');
      const records = q === 'plan'
        ? [{ id: planId, title: 'Plan note', humanKey: 'PRJ-NT-3', recordType: 'note' }]
        : offset >= 5
          ? [{ id: pageTwoId, title: 'Second page', humanKey: null, recordType: 'overview' }]
          : [{ id: alphaId, title: 'Alpha record', humanKey: 'PRJ-NT-1', recordType: 'note' }];
      const total = q === 'plan' ? 1 : 6;
      return new Response(JSON.stringify({ knowledgeRecords: records, total }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <KnowledgeRecordRelationsPanel
        recordId={recordId}
        workspaceId={workspaceId}
        projectId={projectId}
        canEdit
        initial={emptyRelations}
      />,
    );
    await settle(fetchMock);
    expect(fetchMock).not.toHaveBeenCalled();

    clickButton('relatedRecordsAdd');
    await settle(fetchMock);

    expect(document.body.textContent).toContain('Alpha record');
    const firstUrl = new URL(String(fetchMock.mock.calls[0]?.[0]), 'http://localhost');
    expect(firstUrl.pathname).toBe('/api/v1/knowledge-records');
    expect(firstUrl.searchParams.get('workspaceId')).toBe(workspaceId);
    expect(firstUrl.searchParams.get('projectId')).toBe(projectId);
    expect(firstUrl.searchParams.get('workspaceLevel')).toBeNull();
    expect(firstUrl.searchParams.get('limit')).toBe('5');
    expect(firstUrl.searchParams.get('offset')).toBe('0');
    expect(firstUrl.searchParams.get('excludeIds')).toBe(recordId);
    expect(firstUrl.searchParams.has('q')).toBe(false);

    clickButton('documentsNextPage', document.body);
    await settle(fetchMock);
    expect(document.body.textContent).toContain('Second page');
    const pageUrl = new URL(String(fetchMock.mock.calls.at(-1)?.[0]), 'http://localhost');
    expect(pageUrl.searchParams.get('offset')).toBe('5');

    const search = document.querySelector(
      'input[placeholder="relatedRecordsSearch"]',
    );
    if (!(search instanceof HTMLInputElement)) {
      throw new Error('Missing search');
    }
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(search, 'plan');
      search.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 250));
    });
    await settle(fetchMock);
    expect(document.body.textContent).toContain('Plan note');
    const searchUrl = new URL(String(fetchMock.mock.calls.at(-1)?.[0]), 'http://localhost');
    expect(searchUrl.searchParams.get('q')).toBe('plan');
    expect(searchUrl.searchParams.get('offset')).toBe('0');

    const dialog = document.querySelector('[role="dialog"]');
    const radio = dialog?.querySelector('input[type="radio"]');
    if (!(radio instanceof HTMLInputElement) || !dialog) {
      throw new Error('Missing relation target');
    }
    act(() => {
      radio.click();
    });
    clickButton('relatedRecordsAdd', dialog);
    await settle(fetchMock);

    expect(savedLinks).toEqual([
      {
        links: [{ targetRecordId: planId, relationType: 'relates_to' }],
      },
    ]);
    expect(document.body.textContent).toContain('relatedRecordsSaved');
  });

  it('asks for workspace-level records and skips the current relation type', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => new Response(JSON.stringify({
      knowledgeRecords: [{
        id: alphaId,
        title: 'Workspace note',
        humanKey: null,
        recordType: 'note',
      }],
      total: 1,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    render(
      <KnowledgeRecordRelationsPanel
        recordId={recordId}
        workspaceId={workspaceId}
        projectId={null}
        canEdit
        initial={{
          relations: {
            outbound: [{
              relationType: 'depends_on',
              record: {
                id: linkedId,
                humanKey: null,
                title: 'Linked',
                slug: 'linked',
                recordType: 'note',
                lifecycleStatus: 'draft',
                archivedAt: null,
              },
            }],
            inbound: [],
          },
          lifecycleSuccessor: null,
          lifecyclePredecessor: null,
        }}
      />,
    );
    await settle(fetchMock);
    expect(fetchMock).not.toHaveBeenCalled();

    clickButton('relatedRecordsAdd');
    await settle(fetchMock);
    expect(document.body.textContent).toContain('Workspace note');
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]), 'http://localhost');
    expect(url.searchParams.get('workspaceLevel')).toBe('true');
    expect(url.searchParams.get('projectId')).toBeNull();
    expect(url.searchParams.get('excludeIds')?.split(',')).toEqual([recordId]);

    const typeField = Array.from(document.querySelectorAll('label')).find((label) =>
      label.textContent?.includes('relatedRecordsType'),
    );
    const trigger = typeField?.querySelector('.kh-select-trigger');
    if (!(trigger instanceof HTMLButtonElement)) {
      throw new Error('Missing relation type select');
    }
    act(() => {
      trigger.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const option = Array.from(document.querySelectorAll('[role="option"]')).find(
      (element) => element.textContent === 'depends_on',
    );
    if (!option) {
      throw new Error('Missing depends_on option');
    }
    act(() => {
      option.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await settle(fetchMock);
    const nextUrl = new URL(String(fetchMock.mock.calls.at(-1)?.[0]), 'http://localhost');
    expect(nextUrl.searchParams.get('excludeIds')?.split(',')).toEqual([recordId, linkedId]);
  });
});
