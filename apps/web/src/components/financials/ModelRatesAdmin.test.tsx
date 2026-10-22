/**
 * @vitest-environment happy-dom
 */
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ModelRatesAdmin } from './ModelRatesAdmin';
import { ToastProvider } from '../ui/Toast';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
  useLocale: () => 'en',
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
  vi.unstubAllGlobals();
});

function json(body: unknown): Response {
  return {
    ok: true,
    json: async () => body,
    blob: async () => new Blob(),
  } as Response;
}

const price = {
  id: 'global-1',
  workspaceId: null,
  model: '*grok*',
  inputPerMillion: 3,
  outputPerMillion: 15,
  cacheReadPerMillion: 0.75,
  cacheWritePerMillion: 0.3,
  blendedPerMillion: 3,
  currency: 'USD',
  effectiveFrom: '2026-01-01',
  sourceNote: 'https://docs.x.ai/docs/models',
  scope: 'global' as const,
  inherited: true,
  overridden: false,
  overridesGlobal: false,
  retired: false,
};

type ImportPlan = {
  added: Array<{ model: string }>;
  changed: unknown[];
  unchanged: unknown[];
  errors: Array<{ row: number; field: string; message: string }>;
};

type Call = { method: string; url: string };

function isApply(call: Call): boolean {
  return call.method === 'POST' && /\/ai-model-prices\/import$/.test(call.url);
}

async function renderRates(plan: ImportPlan) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ method, url: String(url) });
      if (String(url).includes('/ai-cost')) {
        return json({
          unpricedModels: [{ model: 'cursor-grok-4.5-high', rowCount: 2 }],
        });
      }
      if (String(url).includes('/import/preview')) return json({ plan });
      if (isApply({ method, url: String(url) })) return json({ plan });
      return json({ prices: [price] });
    }),
  );
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <ToastProvider>
        <ModelRatesAdmin scope="workspace" workspaceId="ws-1" canEdit />
      </ToastProvider>,
    );
  });
  mounted.push({ root, container });
  return { container, calls };
}

function button(label: string): HTMLButtonElement | undefined {
  return [...document.body.querySelectorAll('button')].find(
    (item) => item.textContent === label,
  );
}

describe('ModelRatesAdmin', () => {
  it('shows inherited rates in empty fields with the UI sans', async () => {
    const { container } = await renderRates({
      added: [],
      changed: [],
      unchanged: [],
      errors: [],
    });
    expect(container.textContent).toContain('priceInherited');
    expect(container.textContent).toContain('cursor-grok-4.5-high');
    act(() => {
      button('priceOverride')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
    });
    const cacheWrite = [...container.querySelectorAll('input')].find(
      (input) => input.getAttribute('placeholder') === '0.3 (inherited)',
    );
    expect(cacheWrite?.className).toContain('kh-input');
    expect(cacheWrite?.className).toContain('tabular-nums');
    expect(cacheWrite?.className).not.toContain('font-mono');
    expect(container.textContent).not.toContain('pricesTitle');
    expect(container.querySelector('td.kh-ops-num')).toBeTruthy();
    expect(container.querySelector('.font-mono')).toBeNull();
  });

  it('labels a platform row as platform, not inherited', async () => {
    const calls: Call[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ method: init?.method ?? 'GET', url: String(url) });
        return json({ prices: [price] });
      }),
    );
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <ToastProvider>
          <ModelRatesAdmin scope="global" canEdit />
        </ToastProvider>,
      );
    });
    mounted.push({ root, container });
    expect(container.textContent).toContain('priceScopeGlobal');
    expect(container.textContent).not.toContain('priceInherited');
    expect(calls.some((call) => call.url.startsWith('/api/v1/admin/ai-model-prices'))).toBe(
      true,
    );
  });

  it('writes an import only after a valid preview is confirmed', async () => {
    const plan: ImportPlan = {
      added: [{ model: '*grok*' }],
      changed: [],
      unchanged: [],
      errors: [{ row: 2, field: 'unit', message: 'per_1m_tokens' }],
    };
    const { calls } = await renderRates(plan);
    const input = document.body.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    const file = new File(['pattern\n'], 'rates.csv', { type: 'text/csv' });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    await act(async () => {
      Object.defineProperty(input, 'files', {
        value: transfer.files,
        configurable: true,
      });
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await file.text();
    });
    const preview = button('importPreview');
    expect(preview?.disabled).toBe(false);
    await act(async () => {
      preview?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    expect(calls.some((call) => call.url.includes('/import/preview'))).toBe(true);
    expect(calls.some(isApply)).toBe(false);
    expect(button('importApply')?.disabled).toBe(true);

    plan.errors = [];
    await act(async () => {
      preview?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    const apply = button('importApply');
    expect(apply?.disabled).toBe(false);
    await act(async () => {
      apply?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    expect(calls.some(isApply)).toBe(true);
  });
});
