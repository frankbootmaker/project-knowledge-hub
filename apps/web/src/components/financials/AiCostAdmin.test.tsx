/**
 * @vitest-environment happy-dom
 */
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiCostAdmin, type AiBillingEntryRow } from './AiCostAdmin';
import { ToastProvider } from '../ui/Toast';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
  useLocale: () => 'en',
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => undefined }),
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

const mounted: Array<{ root: Root; container: HTMLDivElement }> = [];

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    act(() => {
      entry.root.unmount();
    });
    entry.container.remove();
  }
});

function renderAdmin(node: ReactNode): HTMLDivElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<ToastProvider>{node}</ToastProvider>);
  });
  mounted.push({ root, container });
  return container;
}

function setControl(element: HTMLInputElement | HTMLSelectElement, value: string) {
  act(() => {
    const prototype = Object.getPrototypeOf(element) as object;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
    descriptor?.set?.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

const entry: AiBillingEntryRow = {
  id: 'entry-1',
  period: '2026-09',
  servicePeriodStart: null,
  servicePeriodEnd: null,
  provider: 'Acme Ledger',
  plan: null,
  type: 'subscription',
  amount: 12,
  currency: 'EUR',
  paidAt: null,
  note: null,
  externalRef: null,
  aiSystemId: null,
};

describe('AiCostAdmin cost entry form', () => {
  it('previews a two-month day split and rejects an end before the start', () => {
    renderAdmin(
      <AiCostAdmin
        workspaceId="ws-1"
        workspaceSlug="lab"
        canMutate
        entries={[]}
        chart={[]}
        pools={[]}
        systems={[]}
      />,
    );
    const add = [...document.body.querySelectorAll('button')].find(
      (button) => button.textContent === 'addEntry',
    );
    expect(add).toBeTruthy();
    act(() => {
      add?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const dates = [...document.body.querySelectorAll('input[type="date"]')];
    expect(dates).toHaveLength(2);
    expect(document.body.textContent).toContain('workspacePool');
    expect(document.body.textContent).toContain('workspacePoolHelp');
    setControl(dates[0] as HTMLInputElement, '2026-10-12');
    setControl(dates[1] as HTMLInputElement, '2026-11-11');
    const amount = document.body.querySelector('input[type="number"]') as HTMLInputElement;
    setControl(amount, '31');
    expect(document.body.textContent).toContain('2026-10');
    expect(document.body.textContent).toContain('2026-11');
    expect(document.body.textContent).toContain('€20.00');
    expect(document.body.textContent).toContain('€11.00');
    setControl(dates[1] as HTMLInputElement, '2026-10-01');
    expect(document.body.textContent).toContain('serviceRangeInvalid');
    expect(document.body.textContent).not.toContain('€20.00');
  });

  it('shows Other plus the stored name for a provider that is not listed', () => {
    renderAdmin(
      <AiCostAdmin
        workspaceId="ws-1"
        workspaceSlug="lab"
        canMutate
        entries={[entry]}
        chart={[]}
        pools={[]}
        systems={[]}
      />,
    );
    expect(document.body.textContent).toContain('workspacePool');
    const edit = [...document.body.querySelectorAll('button')].find(
      (button) => button.textContent === 'edit',
    );
    act(() => {
      edit?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const selects = [...document.body.querySelectorAll('select')];
    const provider = selects.find((select) =>
      [...select.options].some((option) => option.value === 'other'),
    );
    expect(provider?.value).toBe('other');
    const custom = [...document.body.querySelectorAll('input')].find(
      (input) => input.value === 'Acme Ledger',
    );
    expect(custom).toBeTruthy();
  });
});
