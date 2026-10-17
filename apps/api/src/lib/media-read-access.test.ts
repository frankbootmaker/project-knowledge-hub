import { describe, expect, it } from 'vitest';
import { AppError } from '@project-knowledge-hub/domain';
import { assertClientCanReadMediaWorkspace } from './media-read-access.js';

const org = '11111111-1111-4111-8111-111111111111';
const otherOrg = '22222222-2222-4222-8222-222222222222';
const workspace = '33333333-3333-4333-8333-333333333333';
const otherWorkspace = '44444444-4444-4444-8444-444444444444';

describe('assertClientCanReadMediaWorkspace', () => {
  it('allows an org-wide reader and an allow-listed workspace', () => {
    expect(() =>
      assertClientCanReadMediaWorkspace(
        { organizationId: org, allowedWorkspaceIds: [] },
        { id: workspace, organizationId: org },
      ),
    ).not.toThrow();
    expect(() =>
      assertClientCanReadMediaWorkspace(
        { organizationId: org, allowedWorkspaceIds: [workspace] },
        { id: workspace, organizationId: org },
      ),
    ).not.toThrow();
  });

  it('forbids another organization even when the workspace id is allow-listed', () => {
    const deny = () =>
      assertClientCanReadMediaWorkspace(
        { organizationId: org, allowedWorkspaceIds: [workspace] },
        { id: workspace, organizationId: otherOrg },
      );
    expect(deny).toThrow(AppError);
    expect(deny).toThrow(/do not have access/);
    expect(() =>
      assertClientCanReadMediaWorkspace(
        { organizationId: org, allowedWorkspaceIds: [] },
        { id: workspace, organizationId: otherOrg },
      ),
    ).toThrow(AppError);
  });

  it('forbids a workspace outside the token allow-list', () => {
    expect(() =>
      assertClientCanReadMediaWorkspace(
        { organizationId: org, allowedWorkspaceIds: [otherWorkspace] },
        { id: workspace, organizationId: org },
      ),
    ).toThrow(AppError);
  });
});
