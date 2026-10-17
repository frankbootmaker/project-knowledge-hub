/**
 * @vitest-environment happy-dom
 */
import { act, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectManageMenu } from './ProjectManageMenu';
import { ProjectTaskManageModal } from './ProjectTaskManageModal';
import { SystemManageMenu } from './SystemManageMenu';
import { ToastProvider } from './ui/Toast';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('next-intl', () => {
  const translate = (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key;
  return {
    useTranslations: () => translate,
    useLocale: () => 'en',
  };
});

const routerRefresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: routerRefresh,
  }),
}));

vi.mock('../lib/use-project-report-preview', () => ({
  useProjectReportPreview: () => ({
    openReport: vi.fn(),
    reportLoading: false,
    reportViewer: null,
  }),
}));

vi.mock('./DeliveryMediaEditor', () => ({
  DeliveryMediaEditor: () => null,
  saveItemMediaLinks: vi.fn(),
}));

vi.mock('./DeliveryDependenciesEditor', () => ({
  DeliveryDependenciesEditor: () => null,
}));

vi.mock('./DeliveryDocumentsEditor', () => ({
  DeliveryDocumentsEditor: () => null,
  saveDeliveryDocumentLinks: vi.fn(),
}));

vi.mock('./DeliveryRaciEditor', () => ({
  DeliveryRaciEditor: () => null,
  saveDeliveryRaci: vi.fn(),
}));

const mounted: Array<{ root: Root; container: HTMLDivElement }> = [];

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    act(() => {
      entry.root.unmount();
    });
    entry.container.remove();
  }
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function renderUi(node: ReactNode): HTMLDivElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(node);
  });
  mounted.push({ root, container });
  return container;
}

async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function click(element: Element) {
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function buttonByExactLabel(container: ParentNode, label: string): HTMLButtonElement {
  const match = [...container.querySelectorAll('button')].find(
    (button) => button.textContent === label,
  );
  if (!match) throw new Error(`Missing button ${label}`);
  return match;
}

function menuItemButton(container: ParentNode, title: string): HTMLButtonElement {
  const strong = [...container.querySelectorAll('button strong')].find(
    (el) => el.textContent === title,
  );
  const button = strong?.closest('button');
  if (!button) throw new Error(`Missing menu item ${title}`);
  return button;
}

const baseTask = {
  id: 'task-1',
  projectId: 'proj-1',
  title: 'Ship feature',
  description: null,
  status: 'todo',
  completionPercent: 0,
  startDate: null,
  dueDate: null,
  durationDays: null,
  forecastHours: null,
  actualHours: null,
  milestoneId: null,
  userStoryId: null,
  userStoryTitle: null,
  epicId: null,
  epicTitle: null,
  currentOwnerUserId: null,
  currentOwner: null,
  tokensUsed: null,
  aiSystemId: null,
  raci: [],
  itemType: 'task' as const,
};

function installTaskFetch(task = baseTask) {
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.includes('/project-tasks/task-1/comments') && method === 'POST') {
        return {
          ok: true,
          json: async () => ({}),
        };
      }
      if (url.includes('/project-tasks/task-1') && method === 'PATCH') {
        return {
          ok: true,
          json: async () => ({ task }),
        };
      }
      if (url.includes('/activities')) {
        return { ok: true, json: async () => ({ activities: [] }) };
      }
      if (url.includes('/raid-items')) {
        return { ok: true, json: async () => ({ raidItems: [] }) };
      }
      if (url.includes('delivery-document-links')) {
        return { ok: true, json: async () => ({ documentLinks: [] }) };
      }
      if (url.includes('/project-tasks/task-1')) {
        return { ok: true, json: async () => ({ task }) };
      }
      if (url.includes('/projects/proj-1')) {
        return {
          ok: true,
          json: async () => ({ project: { workspaceId: 'ws-1' } }),
        };
      }
      return { ok: false, json: async () => ({}) };
    },
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('manage close on save (PRO-B-16)', () => {
  beforeEach(() => {
    routerRefresh.mockClear();
  });

  it('closes the task modal after saving fields and notifies the parent', async () => {
    installTaskFetch();
    const onUpdated = vi.fn();

    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <ProjectTaskManageModal
          open={open}
          onClose={() => setOpen(false)}
          taskId="task-1"
          canMutate
          members={[]}
          epics={[]}
          stories={[]}
          milestones={[]}
          onUpdated={onUpdated}
        />
      );
    }

    renderUi(
      <ToastProvider>
        <Harness />
      </ToastProvider>,
    );

    await flushPromises();
    expect(document.querySelector('.kh-modal')).not.toBeNull();

    click(buttonByExactLabel(document.body, 'saveTask'));
    await flushPromises();

    expect(onUpdated).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.kh-modal')).toBeNull();
  });

  it('keeps the task modal open after adding a comment', async () => {
    installTaskFetch();
    const onClose = vi.fn();

    renderUi(
      <ToastProvider>
        <ProjectTaskManageModal
          open
          onClose={onClose}
          taskId="task-1"
          canMutate
          members={[]}
          epics={[]}
          stories={[]}
          milestones={[]}
        />
      </ToastProvider>,
    );

    await flushPromises();
    click(buttonByExactLabel(document.body, 'tabActivity'));
    await flushPromises();

    const textarea = document.body.querySelector('textarea');
    expect(textarea).not.toBeNull();
    act(() => {
      const field = textarea as HTMLTextAreaElement;
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      setter?.call(field, 'Looks good');
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });

    click(buttonByExactLabel(document.body, 'addComment'));
    await flushPromises();

    expect(onClose).not.toHaveBeenCalled();
    expect(document.querySelector('.kh-modal')).not.toBeNull();
  });

  it('closes the project manage menu after a successful edit save', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ project: { slug: 'demo' } }),
      })),
    );

    const container = renderUi(
      <ToastProvider>
        <ProjectManageMenu
          workspaceSlug="acme"
          canMutate
          canPurge={false}
          project={{
            id: 'p1',
            name: 'Demo',
            slug: 'demo',
            status: 'active',
            summary: null,
            description: null,
            tags: [],
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            archivedAt: null,
          }}
        />
      </ToastProvider>,
    );

    click(buttonByExactLabel(container, 'manage'));
    await flushPromises();
    click(menuItemButton(document.body, 'manageEdit'));
    await flushPromises();
    click(buttonByExactLabel(document.body, 'save'));
    await flushPromises();

    expect(routerRefresh).toHaveBeenCalled();
    expect(document.querySelector('.kh-modal')).toBeNull();
  });

  it('closes the system manage menu after a successful edit save', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ system: { slug: 'crm' } }),
      })),
    );

    const container = renderUi(
      <ToastProvider>
        <SystemManageMenu
          workspaceSlug="acme"
          canMutate
          canPurge={false}
          projects={[]}
          system={{
            id: 's1',
            name: 'CRM',
            slug: 'crm',
            status: 'active',
            summary: null,
            description: null,
            systemType: null,
            environment: null,
            projectId: null,
            tags: [],
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            archivedAt: null,
          }}
        />
      </ToastProvider>,
    );

    click(buttonByExactLabel(container, 'manage'));
    await flushPromises();
    click(menuItemButton(document.body, 'manageEdit'));
    await flushPromises();
    click(buttonByExactLabel(document.body, 'save'));
    await flushPromises();

    expect(routerRefresh).toHaveBeenCalled();
    expect(document.querySelector('.kh-modal')).toBeNull();
  });
});
