/**
 * @vitest-environment happy-dom
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiCostAdmin, type AiBillingEntryRow, type AiCostPool } from './AiCostAdmin';
import { ToastProvider } from '../ui/Toast';
import de from '../../../messages/de.json';
import en from '../../../messages/en.json';
import hu from '../../../messages/hu.json';

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
    const dates = [...document.body.querySelectorAll('[data-date-field]')];
    expect(dates).toHaveLength(2);
    const saveClosed = [...document.body.querySelectorAll('button')].find(
      (button) => button.textContent === 'save',
    );
    expect(saveClosed?.disabled).toBe(true);
    expect(document.body.textContent).toContain('serviceDatesRequired');
    expect(document.body.textContent).toContain('serviceEndHint');
    expect(document.body.textContent).toContain('workspacePool');
    expect(document.body.textContent).toContain('workspacePoolHelp');
    setControl(dates[0] as HTMLInputElement, '2026-10-06');
    setControl(dates[1] as HTMLInputElement, '2026-11-06');
    const amount = document.body.querySelector('input[type="number"]') as HTMLInputElement;
    setControl(amount, '200');
    expect(document.body.textContent).toContain('2026-10');
    expect(document.body.textContent).toContain('2026-11');
    expect(document.body.textContent).toContain('splitDays:{"days":26}');
    expect(document.body.textContent).toContain('splitDays:{"days":5}');
    expect(document.body.textContent).toContain('€167.74');
    expect(document.body.textContent).toContain('€32.26');
    const system = [...document.body.querySelectorAll('select')].find((select) =>
      [...select.options].some((option) => option.textContent === 'workspacePool'),
    );
    expect(system?.closest('label')?.className).toContain('kh-ops-field-span');
    const plan = [...document.body.querySelectorAll('input')].find(
      (input) => input.getAttribute('placeholder') === 'planPlaceholder',
    );
    expect(plan?.tagName).toBe('INPUT');
    const paidAt = document.body.querySelector(
      'input[type="datetime-local"]',
    ) as HTMLInputElement;
    expect(paidAt.value).toBe('');
    expect(paidAt.required).toBe(false);
    const save = [...document.body.querySelectorAll('button')].find(
      (button) => button.textContent === 'save',
    );
    expect(save?.disabled).toBe(false);
    expect(document.body.textContent).not.toContain('serviceDatesRequired');
    setControl(dates[1] as HTMLInputElement, '2026-10-06');
    expect(document.body.textContent).toContain('serviceRangeInvalid');
    expect(save?.disabled).toBe(true);
    expect(document.body.textContent).not.toContain('€167.74');
    setControl(dates[1] as HTMLInputElement, '2026-10-01');
    expect(document.body.textContent).toContain('serviceRangeInvalid');
  });

  it('names the exclusive renewal date in English, German, and Hungarian', () => {
    expect(en.financials.serviceEnd).toBe(
      'Service end (renewal date, not included)',
    );
    expect(en.financials.serviceEndHint).toContain('not billed');
    expect(de.financials.serviceEnd).toContain('nicht enthalten');
    expect(de.financials.serviceEndHint.length).toBeGreaterThan(10);
    expect(hu.financials.serviceEnd).toContain('nem számít bele');
    expect(hu.financials.serviceEndHint.length).toBeGreaterThan(10);
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

function allocationProject(
  name: string,
  patch: Partial<AiCostPool['projects'][number]>,
): AiCostPool['projects'][number] {
  return {
    projectId: name,
    name,
    slug: name,
    tokens: 0,
    overridePercent: null,
    amount: 0,
    method: 'equal',
    ...patch,
  };
}

describe('AiCostAdmin allocation percents (PRO-B-38)', () => {
  it('shows the effective share as a placeholder and totals each month', () => {
    const amounts = [28.86, 28.85, 28.85, 28.85, 28.85, 28.85, 28.85];
    const october: AiCostPool = {
      period: '2026-10',
      currency: 'EUR',
      aiSystemId: null,
      aiSystemName: null,
      paidTotal: 201.96,
      projects: amounts.map((amount, index) =>
        allocationProject(`p${index}`, { amount, method: 'equal' }),
      ),
    };
    const november: AiCostPool = {
      period: '2026-11',
      scheduled: true,
      currency: 'EUR',
      aiSystemId: null,
      aiSystemName: null,
      paidTotal: 100,
      projects: [
        allocationProject('manual', {
          method: 'override',
          overridePercent: 40,
          amount: 40,
        }),
        allocationProject('light', { method: 'tokens', tokens: 1, amount: 15 }),
        allocationProject('heavy', { method: 'tokens', tokens: 3, amount: 45 }),
      ],
    };
    renderAdmin(
      <AiCostAdmin
        workspaceId="ws-1"
        workspaceSlug="lab"
        canMutate
        entries={[]}
        chart={[]}
        pools={[october, november]}
        systems={[]}
      />,
    );
    const inputs = [
      ...document.body.querySelectorAll('input[type="number"]'),
    ] as HTMLInputElement[];
    expect(inputs).toHaveLength(10);
    expect(inputs.slice(0, 7).every((input) => input.value === '')).toBe(true);
    expect(inputs.slice(0, 7).map((input) => input.placeholder)).toEqual([
      '14.29',
      '14.29',
      '14.29',
      '14.29',
      '14.28',
      '14.28',
      '14.28',
    ]);
    for (const input of inputs.slice(0, 7)) {
      expect(input.className).toContain('kh-ops-percent-input');
      expect(input.className).toContain('kh-ops-percent-computed');
    }
    expect(inputs[7]?.value).toBe('40');
    expect(inputs[7]?.className.includes('kh-ops-percent-computed')).toBe(false);
    expect(inputs[8]?.placeholder).toBe('15.00');
    expect(inputs[9]?.placeholder).toBe('45.00');
    const footers = [...document.body.querySelectorAll('tfoot')];
    expect(footers).toHaveLength(2);
    expect(footers[0]?.textContent).toContain('100%');
    expect(footers[0]?.textContent).toContain('201.96');
    expect(footers[1]?.textContent).toContain('100%');
    const novemberCells = [...(footers[1]?.querySelectorAll('td') ?? [])].map((cell) =>
      cell.textContent?.trim(),
    );
    expect(novemberCells[0]).toBe('4');
    expect(document.body.textContent).toContain('scheduled');
    const css = readFileSync(join(process.cwd(), 'src/styles/ops-shell.css'), 'utf8');
    const start = css.indexOf('.kh-ops-data-table .kh-ops-percent-input');
    const rule = css.slice(start, css.indexOf('.kh-ops-cost-split', start));
    expect(rule).toContain('var(--font-sans)');
    expect(rule).toContain('tabular-nums');
    expect(rule).not.toContain('monospace');
  });
});
