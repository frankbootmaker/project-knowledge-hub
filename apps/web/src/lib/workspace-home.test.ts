import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch, readSessionToken } from './session';
import { loadWorkspaceHome } from './workspace-home';

vi.mock('./session', () => ({
  apiFetch: vi.fn(async () => ({
    ok: true,
    json: async () => ({}),
  })),
  readSessionToken: vi.fn(async () => 'token-a'),
}));

const fetchMock = vi.mocked(apiFetch);
const tokenMock = vi.mocked(readSessionToken);

describe('loadWorkspaceHome', () => {
  beforeEach(() => {
    fetchMock.mockClear();
    tokenMock.mockClear();
  });

  it('issues each catalogue request once when the shell renders twice', async () => {
    const workspaceId = '11111111-1111-1111-1111-111111111111';
    await Promise.all([loadWorkspaceHome(workspaceId), loadWorkspaceHome(workspaceId)]);
    const paths = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(paths).toHaveLength(5);
    expect(paths.filter((path) => path.includes('/projects?'))).toHaveLength(1);
    expect(paths.filter((path) => path.includes('/systems?'))).toHaveLength(1);
    expect(paths.filter((path) => path.includes('/knowledge-records?'))).toHaveLength(1);
    expect(paths.filter((path) => path.includes('git-connections'))).toHaveLength(1);
    expect(paths.some((path) => path.includes('summary=true'))).toBe(true);
    expect(paths.some((path) => path.includes('checkRemote=false'))).toBe(true);
    expect(paths.some((path) => path.includes('checkRemote=true'))).toBe(false);
  });

  it('does not share a catalogue across workspaces', async () => {
    await loadWorkspaceHome('22222222-2222-2222-2222-222222222222');
    await loadWorkspaceHome('33333333-3333-3333-3333-333333333333');
    expect(fetchMock).toHaveBeenCalledTimes(10);
  });
});
