import { describe, expect, it } from 'vitest';
import {
  canAdministerWorkspace,
  canManageWorkspaceSettings,
  canViewWorkspace,
  type AuthPrincipal,
} from './index.js';

const reader: AuthPrincipal = {
  userId: 'u1',
  email: 'reader@example.com',
  displayName: 'Reader',
  isSystemAdmin: false,
  memberships: [{ workspaceId: 'w1', role: 'reader' }],
};

const admin: AuthPrincipal = {
  userId: 'u2',
  email: 'admin@example.com',
  displayName: 'Admin',
  isSystemAdmin: false,
  memberships: [{ workspaceId: 'w1', role: 'workspace_admin' }],
};

describe('permissions', () => {
  it('allows readers to view but not administer', () => {
    expect(canViewWorkspace(reader, 'w1')).toBe(true);
    expect(canAdministerWorkspace(reader, 'w1')).toBe(false);
    expect(canManageWorkspaceSettings(reader, 'w1')).toBe(false);
  });

  it('allows workspace admins to manage settings', () => {
    expect(canManageWorkspaceSettings(admin, 'w1')).toBe(true);
  });
});
