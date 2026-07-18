import { AppError, type MembershipRole } from '@project-knowledge-hub/domain';

export type AuthPrincipal = {
  userId: string;
  email: string;
  displayName: string;
  isSystemAdmin: boolean;
  memberships: Array<{
    workspaceId: string;
    role: MembershipRole;
  }>;
};

export function canViewWorkspace(principal: AuthPrincipal, workspaceId: string): boolean {
  if (principal.isSystemAdmin) {
    return true;
  }
  return principal.memberships.some((membership) => membership.workspaceId === workspaceId);
}

export function canAdministerWorkspace(principal: AuthPrincipal, workspaceId: string): boolean {
  if (principal.isSystemAdmin) {
    return true;
  }

  const membership = principal.memberships.find((item) => item.workspaceId === workspaceId);
  if (!membership) {
    return false;
  }

  return membership.role === 'workspace_admin' || membership.role === 'maintainer';
}

export function canManageWorkspaceSettings(
  principal: AuthPrincipal,
  workspaceId: string,
): boolean {
  if (principal.isSystemAdmin) {
    return true;
  }

  const membership = principal.memberships.find((item) => item.workspaceId === workspaceId);
  return membership?.role === 'workspace_admin';
}

export function requireSystemAdmin(principal: AuthPrincipal): void {
  if (!principal.isSystemAdmin) {
    throw new AppError({
      code: 'FORBIDDEN',
      message: 'System administrator privileges are required',
      statusCode: 403,
    });
  }
}

export function requireWorkspaceView(principal: AuthPrincipal, workspaceId: string): void {
  if (!canViewWorkspace(principal, workspaceId)) {
    throw new AppError({
      code: 'FORBIDDEN',
      message: 'You do not have access to this workspace',
      statusCode: 403,
    });
  }
}

export function requireWorkspaceAdmin(principal: AuthPrincipal, workspaceId: string): void {
  if (!canManageWorkspaceSettings(principal, workspaceId)) {
    throw new AppError({
      code: 'FORBIDDEN',
      message: 'Workspace administrator privileges are required',
      statusCode: 403,
    });
  }
}

export function requireWorkspaceMaintainer(principal: AuthPrincipal, workspaceId: string): void {
  if (!canAdministerWorkspace(principal, workspaceId)) {
    throw new AppError({
      code: 'FORBIDDEN',
      message: 'Workspace maintainer privileges are required',
      statusCode: 403,
    });
  }
}
