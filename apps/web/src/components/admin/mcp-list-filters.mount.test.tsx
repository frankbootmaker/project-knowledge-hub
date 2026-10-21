/**
 * @vitest-environment happy-dom
 */
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClientsAdmin, type PublicApiClient } from './ApiClientsAdmin';
import { OauthGrantsList, type OauthGrantRow } from './OauthGrantsList';
import { ToastProvider } from '../ui/Toast';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
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

function setControl(element: HTMLInputElement | HTMLSelectElement, value: string) {
  act(() => {
    const prototype = Object.getPrototypeOf(element) as object;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
    descriptor?.set?.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function selectByLabel(container: ParentNode, label: string): HTMLSelectElement {
  const element = container.querySelector(`select[aria-label="${label}"]`);
  if (!(element instanceof HTMLSelectElement)) {
    throw new Error(`missing select ${label}`);
  }
  return element;
}

const users = [{ id: 'user-ada', email: 'ada@example.com', displayName: 'Ada Lovelace' }];

function apiClient(
  overrides: Partial<PublicApiClient> & Pick<PublicApiClient, 'id' | 'name'>,
): PublicApiClient {
  return {
    organizationId: 'org-1',
    description: null,
    tokenPrefix: null,
    scopes: ['projects:read'],
    allowedWorkspaceIds: [],
    allowedProjectIds: [],
    actingUserId: null,
    status: 'active',
    expiresAt: null,
    lastUsedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const clients: PublicApiClient[] = [
  apiClient({
    id: 'client-live',
    name: 'Cursor desktop',
    tokenPrefix: 'kh_live_abcd',
    actingUserId: 'user-ada',
    scopes: ['projects:read', 'knowledge:write'],
    createdAt: '2026-03-01T00:00:00.000Z',
    lastUsedAt: '2026-10-01T00:00:00.000Z',
  }),
  apiClient({
    id: 'client-old',
    name: 'Old token',
    tokenPrefix: 'kh_old_9999',
    expiresAt: '2000-01-01T00:00:00.000Z',
    scopes: ['knowledge:search'],
    createdAt: '2026-01-15T00:00:00.000Z',
  }),
];

function grant(overrides: Partial<OauthGrantRow> & Pick<OauthGrantRow, 'id'>): OauthGrantRow {
  return {
    userId: 'user-1',
    userEmail: 'ada@example.com',
    userDisplayName: 'Ada Lovelace',
    organizationId: 'org-1',
    clientHost: 'chatgpt.com',
    clientId: 'https://chatgpt.com/oauth/client-a',
    scopes: ['projects:read'],
    allowedWorkspaceIds: [],
    status: 'active',
    lastUsedAt: '2026-10-02T00:00:00.000Z',
    refreshExpiresAt: '2099-01-01T00:00:00.000Z',
    createdAt: '2026-04-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('MCP list headers', () => {
  it('filters API clients by derived expiry and shows an empty-filter message', () => {
    const container = render(
      <ApiClientsAdmin
        initialClients={clients}
        organizations={[{ id: 'org-1', name: 'Org', slug: 'org' }]}
        workspaces={[]}
        users={users}
      />,
    );
    const search = container.querySelector('input[type="search"]');
    expect(search).toBeTruthy();
    expect(container.textContent).toContain('listResultCount:{"shown":2,"total":2}');
    expect(container.textContent).toContain('Cursor desktop');
    expect(container.textContent).toContain('Old token');
    const clear = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('clearFilters'),
    );
    expect(clear?.hasAttribute('disabled')).toBe(true);

    setControl(selectByLabel(container, 'apiClientsFilterStatus'), 'expired');
    expect(container.textContent).toContain('Old token');
    expect(container.textContent).not.toContain('Cursor desktop');
    expect(container.textContent).toContain('statusExpired');
    expect(container.textContent).toContain('listResultCount:{"shown":1,"total":2}');

    setControl(selectByLabel(container, 'apiClientsFilterStatus'), 'all');
    const searchInput = container.querySelector('input[type="search"]');
    if (!(searchInput instanceof HTMLInputElement)) throw new Error('missing search');
    setControl(searchInput, 'missing-client');
    expect(container.querySelector('.kh-ops-empty')?.textContent).toBe('emptyClientsFiltered');
  });

  it('filters OAuth grants by client and derived refresh expiry', () => {
    const container = render(
      <OauthGrantsList
        grants={[
          grant({ id: 'g-chatgpt' }),
          grant({
            id: 'g-claude',
            clientHost: 'claude.ai',
            clientId: 'https://claude.ai/oauth/client-b',
            userDisplayName: 'Grace Hopper',
            userEmail: 'grace@example.com',
            refreshExpiresAt: '2000-01-01T00:00:00.000Z',
            lastUsedAt: null,
            createdAt: '2026-09-01T00:00:00.000Z',
          }),
        ]}
        workspaceNames={{}}
        revokeBase="/api/v1/oauth/grants"
        showUser
        title="OAuth grants"
        blurb="Connected accounts"
      />,
    );
    expect(container.querySelector('input[type="search"]')).toBeTruthy();
    expect(container.textContent).toContain('listResultCount:{"shown":2,"total":2}');
    expect(container.textContent).toContain('ChatGPT');
    expect(container.textContent).toContain('Claude');

    setControl(selectByLabel(container, 'oauthGrantFilterStatus'), 'expired');
    expect(container.textContent).toContain('Grace Hopper');
    expect(container.textContent).toContain('oauthGrantExpired');
    expect(container.textContent).not.toContain('Ada Lovelace');

    setControl(selectByLabel(container, 'oauthGrantFilterStatus'), 'all');
    setControl(selectByLabel(container, 'oauthGrantFilterClient'), 'Claude');
    expect(container.textContent).toContain('Grace Hopper');
    expect(container.textContent).not.toContain('Ada Lovelace');

    setControl(selectByLabel(container, 'oauthGrantFilterClient'), 'all');
    const search = container.querySelector('input[type="search"]');
    if (!(search instanceof HTMLInputElement)) throw new Error('missing search');
    setControl(search, 'nobody');
    expect(container.querySelector('.kh-ops-empty')?.textContent).toBe('oauthGrantEmptyFiltered');
  });
});
