/**
 * @vitest-environment happy-dom
 */
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  UsageImportAdmin,
  type UnassignedUsageGroup,
  type UsageImportRow,
} from './UsageImportAdmin';
import { ToastProvider } from '../ui/Toast';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => 'en',
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => undefined }),
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

function button(label: string): HTMLButtonElement | undefined {
  return [...document.body.querySelectorAll('button')].find(
    (item) => item.textContent === label,
  ) as HTMLButtonElement | undefined;
}

describe('UsageImportAdmin file selection', () => {
  it('enables Preview and Import after the first CSV, including the same file again', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ prices: [] }) })),
    );
    render(
      <UsageImportAdmin
        workspaceId="ws-1"
        canImport
        imports={[]}
        unassignedTotal={0}
        unassigned={[]}
      />,
    );
    expect(button('usagePreview')?.disabled).toBe(true);
    expect(button('usageConfirm')?.disabled).toBe(true);
    expect(document.body.querySelector('input[type="search"]')).toBeNull();
    const input = document.body.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['Date,Model\n'], 'usage.csv', { type: 'text/csv' });
    await act(async () => {
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(document.body.textContent).toContain('usage.csv');
    expect(button('usagePreview')?.disabled).toBe(false);
    expect(button('usageConfirm')?.disabled).toBe(false);
    expect(input.value).toBe('');
    await act(async () => {
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(button('usagePreview')?.disabled).toBe(false);
    expect(button('usageConfirm')?.disabled).toBe(false);
  });
});

const alpha: UnassignedUsageGroup = {
  cloudAgentId: 'bc-alpha',
  rowCount: 2,
  tokensTotal: 1000,
  latestAt: '2026-10-01T12:00:00.000Z',
  models: ['gpt-5'],
};

const beta: UnassignedUsageGroup = {
  cloudAgentId: 'bc-beta',
  rowCount: 4,
  tokensTotal: 50,
  latestAt: '2026-10-20T12:00:00.000Z',
  models: ['claude-sonnet'],
};

function setControl(element: HTMLInputElement | HTMLSelectElement, value: string) {
  act(() => {
    const prototype = Object.getPrototypeOf(element) as object;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
    descriptor?.set?.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function clickCheckbox(root: ParentNode, labelText: string) {
  const label = [...root.querySelectorAll('label')].find((node) =>
    node.textContent?.includes(labelText),
  );
  const input = label?.querySelector('input');
  if (!(input instanceof HTMLInputElement)) {
    throw new Error(`missing checkbox ${labelText}`);
  }
  act(() => {
    input.click();
  });
}

function unassignedBody(container: HTMLElement): string {
  const table = container.querySelector('table.kh-ops-data-table--fluid');
  return table?.querySelector('tbody')?.textContent ?? '';
}

function openFilters(): HTMLElement {
  const existing = document.body.querySelector('.kh-ops-table-filter');
  if (existing instanceof HTMLElement) return existing;
  const toggle = document.body.querySelector('button[aria-label="showFilters"]');
  if (!(toggle instanceof HTMLButtonElement)) throw new Error('missing filter toggle');
  act(() => {
    toggle.click();
  });
  const menu = document.body.querySelector('.kh-ops-table-filter');
  if (!(menu instanceof HTMLElement)) throw new Error('missing filter menu');
  return menu;
}

describe('Unassigned usage filters', () => {
  function renderGroups(imports: UsageImportRow[] = []) {
    return render(
      <UsageImportAdmin
        workspaceId="ws-1"
        canImport
        imports={imports}
        unassignedTotal={2}
        unassigned={[alpha, beta]}
        unassignedTheoretical={[{ currency: 'USD', amount: 12.5 }]}
      />,
    );
  }

  it('searches, filters model and date, and omits hidden groups from the table', () => {
    const container = renderGroups();
    const body = () => unassignedBody(container);
    expect(body()).toContain('bc-alpha');
    expect(body()).toContain('bc-beta');
    expect(body()).toContain('gpt-5');
    expect(container.querySelector('td.kh-ops-num')?.className).toContain('kh-ops-cell-number');
    expect(container.textContent).toContain('theoreticalUnassigned');

    const search = container.querySelector('input[aria-label="usageUnassignedSearch"]');
    if (!(search instanceof HTMLInputElement)) throw new Error('missing search');
    setControl(search, 'gpt-5');
    expect(body()).toContain('bc-alpha');
    expect(body()).not.toContain('bc-beta');

    setControl(search, 'no-such-agent');
    expect(body()).toBe('');
    expect(container.textContent).toContain('emptyFiltered');
    expect(container.textContent).toContain('theoreticalUnassigned');

    setControl(search, '');
    expect(body()).toContain('bc-alpha');
    expect(body()).toContain('bc-beta');

    const menu = openFilters();
    clickCheckbox(menu, 'claude-sonnet');
    expect(body()).toContain('bc-beta');
    expect(body()).not.toContain('bc-alpha');
    expect(body()).not.toContain('gpt-5');

    const clear = container.querySelector('.kh-ops-tree-filter-clear');
    if (!(clear instanceof HTMLButtonElement)) throw new Error('missing clear');
    act(() => {
      clear.click();
    });
    expect(body()).toContain('bc-alpha');
    expect(body()).toContain('bc-beta');

    const agent = openFilters().querySelector('input[aria-label="filterColumn"]');
    if (!(agent instanceof HTMLInputElement)) throw new Error('missing agent filter');
    setControl(agent, 'beta');
    expect(body()).toContain('bc-beta');
    expect(body()).not.toContain('bc-alpha');
    const clearAgent = container.querySelector('.kh-ops-tree-filter-clear');
    if (!(clearAgent instanceof HTMLButtonElement)) throw new Error('missing agent clear');
    act(() => {
      clearAgent.click();
    });
    expect(body()).toContain('bc-alpha');

    const dates = openFilters();
    const from = dates.querySelector('input[aria-label="from"]');
    if (!(from instanceof HTMLInputElement)) throw new Error('missing from');
    setControl(from, '2026-10-15');
    expect(body()).toContain('bc-beta');
    expect(body()).not.toContain('bc-alpha');

    const to = dates.querySelector('input[aria-label="to"]');
    if (!(to instanceof HTMLInputElement)) throw new Error('missing to');
    setControl(to, '2026-10-10');
    expect(body()).toBe('');
    expect(container.querySelector('.kh-ops-empty-state')?.textContent).toContain('emptyFiltered');

    const clearDates = container.querySelector('.kh-ops-tree-filter-clear');
    if (!(clearDates instanceof HTMLButtonElement)) throw new Error('missing date clear');
    act(() => {
      clearDates.click();
    });
    expect(body()).toContain('bc-alpha');
    expect(body()).toContain('bc-beta');
  });

  it('keeps the import log when the unassigned table is filtered', () => {
    const item: UsageImportRow = {
      id: 'imp-1',
      source: 'csv',
      fileName: 'october.csv',
      createdBy: { displayName: 'Ada Lovelace', email: 'ada@example.com' },
      createdAt: '2026-10-21T00:00:00.000Z',
      rowCountTotal: 3,
      rowCountInserted: 3,
      rowCountDuplicate: 0,
      rowCountLinked: 1,
      rowCountErrors: 0,
      rowCountNoTokens: 0,
      errors: [],
      summary: null,
    };
    const container = renderGroups([item]);
    expect(container.textContent).toContain('october.csv');
    expect(container.textContent).toContain('Ada Lovelace');
    const search = container.querySelector('input[aria-label="usageUnassignedSearch"]');
    if (!(search instanceof HTMLInputElement)) throw new Error('missing search');
    setControl(search, 'bc-beta');
    expect(unassignedBody(container)).toContain('bc-beta');
    expect(unassignedBody(container)).not.toContain('bc-alpha');
    expect(container.textContent).toContain('october.csv');
    expect(container.textContent).toContain('usageLogTitle');
    expect(container.querySelectorAll('input[aria-label="usageUnassignedSearch"]')).toHaveLength(1);
  });
});
