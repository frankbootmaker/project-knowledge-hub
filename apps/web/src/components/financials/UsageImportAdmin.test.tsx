/**
 * @vitest-environment happy-dom
 */
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UsageImportAdmin } from './UsageImportAdmin';
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
