/**
 * @vitest-environment happy-dom
 */
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MonitoringDashboard } from './MonitoringDashboard';
import type { MonitoringAuditError, MonitoringPayload } from './monitoring-types';
import { ToastProvider } from '../ui/Toast';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: () => undefined, refresh: () => undefined }),
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

function choose(container: ParentNode, label: string, optionText: string) {
  const trigger = [...container.querySelectorAll('button[aria-haspopup="listbox"]')].find(
    (node) => node.getAttribute('aria-label')?.startsWith(`${label},`),
  );
  if (!(trigger instanceof HTMLButtonElement)) throw new Error(`missing ${label}`);
  act(() => {
    trigger.click();
  });
  const option = [...document.querySelectorAll('[role="option"]')].find(
    (node) => node.textContent?.trim() === optionText,
  );
  if (!(option instanceof HTMLButtonElement)) {
    const found = [...document.querySelectorAll('[role="option"]')].map((node) => node.textContent);
    throw new Error(`missing option ${optionText}; saw ${found.join(' | ')}`);
  }
  act(() => {
    option.click();
  });
}

function row(
  id: string,
  errorType: MonitoringAuditError['errorType'],
  tool: string,
  clientId: string,
  clientName: string,
): MonitoringAuditError {
  return {
    id,
    action: 'mcp.tool_error',
    entityType: 'mcp_tool',
    entityId: tool,
    createdAt: '2026-10-22T12:00:00.000Z',
    errorType,
    message: `${tool} failed safely`,
    client: { id: clientId, name: clientName, kind: 'api_client', oauthClientId: null },
    clientInfo: { name: 'cursor-test', version: '1.2.3' },
    user: { id: 'user-1', name: 'Ada' },
  };
}

function payload(errors: MonitoringAuditError[]): MonitoringPayload {
  return {
    overall: 'healthy',
    generatedAt: '2026-10-22T12:00:00.000Z',
    app: {
      env: 'test',
      apiUrl: 'http://localhost:3101',
      webUrl: 'http://localhost:3100',
      schemaVersion: 'test',
    },
    health: { api: 'ok', ready: true, checks: { postgres: 'ok', redis: 'ok' } },
    attention: {
      pendingUsers: 0,
      pendingApiClients: 0,
      staleBackup: false,
      staleBackupAfterHours: 36,
      staleOffsite: false,
      staleOffsiteAfterHours: 48,
      onDutyAdmins: [],
    },
    sessions: { active: 0 },
    mcp: {
      range: '24h',
      requestCount: 0,
      toolCallCount: 0,
      toolErrorCount: errors.length,
      topActions: [],
    },
    clients: { range: '24h', leaderboard: [] },
    catalogue: { range: '24h', topRecords: [], topProjects: [], topSystems: [] },
    recentAuditErrors: errors,
    maintenance: {
      embeddingProvider: 'disabled',
      workspaces: [],
      archived: { workspaces: 0, projects: 0, systems: 0, knowledgeRecords: 0 },
    },
    backups: {
      dir: './backups',
      toolsHint: '',
      lastSuccess: { stamp: null, ageSeconds: null },
      lastImport: { stamp: null, ageSeconds: null },
      lastFailure: { stamp: null, ageSeconds: null },
      artifacts: [],
      totalBytes: 0,
      maxUploadBytes: 1,
      retention: {
        keepDaily: 7,
        keepWeekly: 4,
        keepMonthly: 3,
        autoRotate: true,
        source: 'env',
      },
      schedule: { enabled: true, intervalSeconds: 86400, source: 'env' },
      lastOffsite: { stamp: null, ageSeconds: null },
      lastOffsiteError: { stamp: null, ageSeconds: null },
      lastLocalRotation: { stamp: null, ageSeconds: null },
      lastS3Rotation: { stamp: null, ageSeconds: null },
      staleOffsite: false,
      staleOffsiteAfterHours: 48,
      offsite: { enabled: false, provider: 'disabled', auto: false },
      staleAfterHours: 36,
    },
  };
}

const errors = [
  row('1', 'validation', 'list_projects', 'ci', 'CI tester'),
  row('2', 'internal', 'search_knowledge', 'ci', 'CI tester'),
  row('3', 'forbidden', 'get_project', 'chatgpt', 'ChatGPT'),
];

function listedTools(container: ParentNode): string[] {
  const section = container.querySelector('#audit-errors');
  return [...(section?.querySelectorAll('.kh-ops-list-title') ?? [])].map(
    (node) => node.textContent?.trim() ?? '',
  );
}

describe('monitoring audit error filters', () => {
  it('filters the list by error type and by client', () => {
    const container = render(
      <MonitoringDashboard
        title="Monitoring"
        description="Ops"
        initial={payload(errors)}
        initialRange="24h"
        initialAlerts={null}
        tab="dashboard"
      />,
    );

    expect(listedTools(container)).toEqual([
      'list_projects',
      'search_knowledge',
      'get_project',
    ]);

    choose(container, 'monitoringAuditErrorType', 'monitoringAuditErrorInternal');
    expect(listedTools(container)).toEqual(['search_knowledge']);

    choose(container, 'monitoringAuditErrorType', 'monitoringAuditErrorTypeAll');
    choose(container, 'monitoringAuditErrorClient', 'ChatGPT · cursor-test');
    expect(listedTools(container)).toEqual(['get_project']);
  });
});
