import { describe, expect, it } from 'vitest';
import { AppError } from '@project-knowledge-hub/domain';
import { assertFilterEntityInProject } from './mcp-tools.js';
import type { FilterEntityType, EntityRow, RequestedProject } from './mcp-tools.js';

/**
 * Unit tests for cross-project filter validation (PRO-T-7).
 * Tests the pure validation logic that checks if a filter entity belongs to the requested project.
 */

describe('assertFilterEntityInProject (PRO-T-7)', () => {
  const requestedProject: RequestedProject = {
    id: 'project-pro-id',
    workspaceId: 'workspace-1',
    keyPrefix: 'PRO',
    name: 'Project PRO',
  };

  const otherProject = {
    id: 'project-fur-id',
    workspaceId: 'workspace-1',
    keyPrefix: 'FUR',
    name: 'Project FUR',
  };

  const otherWorkspaceProject = {
    id: 'project-pnz-id',
    workspaceId: 'workspace-2',
    keyPrefix: 'PNZ',
    name: 'Project PNZ',
  };

  describe('milestone filter', () => {
    it('should allow milestone in the requested project', () => {
      const entityRow: EntityRow = {
        projectId: requestedProject.id,
        workspaceId: requestedProject.workspaceId,
        keyPrefix: 'PRO',
        issueKeyType: 'M',
        issueNumber: 1,
      };

      expect(() =>
        assertFilterEntityInProject({
          entityType: 'milestone',
          entityRow,
          requestedProject,
          idOrKey: 'PRO-M-1',
        }),
      ).not.toThrow();
    });

    it('should reject milestone from another project in the same workspace', () => {
      const entityRow: EntityRow = {
        projectId: otherProject.id,
        workspaceId: requestedProject.workspaceId,
        keyPrefix: 'FUR',
        issueKeyType: 'M',
        issueNumber: 1,
      };

      expect(() =>
        assertFilterEntityInProject({
          entityType: 'milestone',
          entityRow,
          requestedProject,
          idOrKey: 'FUR-M-1',
        }),
      ).toThrow(
        new AppError({
          code: 'ENTITY_NOT_IN_PROJECT',
          message: 'Milestone FUR-M-1 does not belong to project PRO',
          statusCode: 400,
        }),
      );
    });

    it('should return generic not-found for milestone in a different workspace', () => {
      const entityRow: EntityRow = {
        projectId: otherWorkspaceProject.id,
        workspaceId: otherWorkspaceProject.workspaceId,
        keyPrefix: 'PNZ',
        issueKeyType: 'M',
        issueNumber: 1,
      };

      expect(() =>
        assertFilterEntityInProject({
          entityType: 'milestone',
          entityRow,
          requestedProject,
          idOrKey: 'PNZ-M-1',
        }),
      ).toThrow(
        new AppError({
          code: 'ENTITY_NOT_FOUND',
          message: 'Milestone PNZ-M-1 not found in project PRO',
          statusCode: 404,
        }),
      );
    });

    it('should handle UUID with same error for cross-project in same workspace', () => {
      const entityRow: EntityRow = {
        projectId: otherProject.id,
        workspaceId: requestedProject.workspaceId,
        keyPrefix: 'FUR',
        issueKeyType: 'M',
        issueNumber: 1,
      };

      const uuid = 'a0b1c2d3-e4f5-6789-abcd-ef0123456789';

      expect(() =>
        assertFilterEntityInProject({
          entityType: 'milestone',
          entityRow,
          requestedProject,
          idOrKey: uuid,
        }),
      ).toThrow(
        new AppError({
          code: 'ENTITY_NOT_IN_PROJECT',
          message: 'Milestone FUR-M-1 does not belong to project PRO',
          statusCode: 400,
        }),
      );
    });
  });

  describe('sprint filter', () => {
    it('should allow sprint in the requested project', () => {
      const entityRow: EntityRow = {
        projectId: requestedProject.id,
        workspaceId: requestedProject.workspaceId,
        keyPrefix: 'PRO',
        issueKeyType: 'SP',
        issueNumber: 1,
      };

      expect(() =>
        assertFilterEntityInProject({
          entityType: 'sprint',
          entityRow,
          requestedProject,
          idOrKey: 'PRO-SP-1',
        }),
      ).not.toThrow();
    });

    it('should reject sprint from another project in the same workspace', () => {
      const entityRow: EntityRow = {
        projectId: otherProject.id,
        workspaceId: requestedProject.workspaceId,
        keyPrefix: 'PNZ',
        issueKeyType: 'SP',
        issueNumber: 1,
      };

      expect(() =>
        assertFilterEntityInProject({
          entityType: 'sprint',
          entityRow,
          requestedProject,
          idOrKey: 'PNZ-SP-1',
        }),
      ).toThrow(
        new AppError({
          code: 'ENTITY_NOT_IN_PROJECT',
          message: 'Sprint PNZ-SP-1 does not belong to project PRO',
          statusCode: 400,
        }),
      );
    });
  });

  describe('epic filter', () => {
    it('should allow epic in the requested project', () => {
      const entityRow: EntityRow = {
        projectId: requestedProject.id,
        workspaceId: requestedProject.workspaceId,
        keyPrefix: 'PRO',
        issueKeyType: 'E',
        issueNumber: 1,
      };

      expect(() =>
        assertFilterEntityInProject({
          entityType: 'epic',
          entityRow,
          requestedProject,
          idOrKey: 'PRO-E-1',
        }),
      ).not.toThrow();
    });

    it('should reject epic from another project in the same workspace', () => {
      const entityRow: EntityRow = {
        projectId: otherProject.id,
        workspaceId: requestedProject.workspaceId,
        keyPrefix: 'FUR',
        issueKeyType: 'E',
        issueNumber: 1,
      };

      expect(() =>
        assertFilterEntityInProject({
          entityType: 'epic',
          entityRow,
          requestedProject,
          idOrKey: 'FUR-E-1',
        }),
      ).toThrow(
        new AppError({
          code: 'ENTITY_NOT_IN_PROJECT',
          message: 'Epic FUR-E-1 does not belong to project PRO',
          statusCode: 400,
        }),
      );
    });
  });

  describe('user story filter', () => {
    it('should allow user story in the requested project', () => {
      const entityRow: EntityRow = {
        projectId: requestedProject.id,
        workspaceId: requestedProject.workspaceId,
        keyPrefix: 'PRO',
        issueKeyType: 'S',
        issueNumber: 1,
      };

      expect(() =>
        assertFilterEntityInProject({
          entityType: 'user_story',
          entityRow,
          requestedProject,
          idOrKey: 'PRO-S-1',
        }),
      ).not.toThrow();
    });

    it('should reject user story from another project in the same workspace', () => {
      const entityRow: EntityRow = {
        projectId: otherProject.id,
        workspaceId: requestedProject.workspaceId,
        keyPrefix: 'FUR',
        issueKeyType: 'S',
        issueNumber: 1,
      };

      expect(() =>
        assertFilterEntityInProject({
          entityType: 'user_story',
          entityRow,
          requestedProject,
          idOrKey: 'FUR-S-1',
        }),
      ).toThrow(
        new AppError({
          code: 'ENTITY_NOT_IN_PROJECT',
          message: 'User story FUR-S-1 does not belong to project PRO',
          statusCode: 400,
        }),
      );
    });
  });

  describe('entity type labels', () => {
    it('should use "Milestone" for milestone type', () => {
      const entityRow: EntityRow = {
        projectId: otherProject.id,
        workspaceId: requestedProject.workspaceId,
        keyPrefix: 'FUR',
        issueKeyType: 'M',
        issueNumber: 1,
      };

      try {
        assertFilterEntityInProject({
          entityType: 'milestone',
          entityRow,
          requestedProject,
          idOrKey: 'FUR-M-1',
        });
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        expect((error as AppError).message).toContain('Milestone');
      }
    });

    it('should use "Sprint" for sprint type', () => {
      const entityRow: EntityRow = {
        projectId: otherProject.id,
        workspaceId: requestedProject.workspaceId,
        keyPrefix: 'FUR',
        issueKeyType: 'SP',
        issueNumber: 1,
      };

      try {
        assertFilterEntityInProject({
          entityType: 'sprint',
          entityRow,
          requestedProject,
          idOrKey: 'FUR-SP-1',
        });
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        expect((error as AppError).message).toContain('Sprint');
      }
    });

    it('should use "Epic" for epic type', () => {
      const entityRow: EntityRow = {
        projectId: otherProject.id,
        workspaceId: requestedProject.workspaceId,
        keyPrefix: 'FUR',
        issueKeyType: 'E',
        issueNumber: 1,
      };

      try {
        assertFilterEntityInProject({
          entityType: 'epic',
          entityRow,
          requestedProject,
          idOrKey: 'FUR-E-1',
        });
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        expect((error as AppError).message).toContain('Epic');
      }
    });

    it('should use "User story" for user_story type', () => {
      const entityRow: EntityRow = {
        projectId: otherProject.id,
        workspaceId: requestedProject.workspaceId,
        keyPrefix: 'FUR',
        issueKeyType: 'S',
        issueNumber: 1,
      };

      try {
        assertFilterEntityInProject({
          entityType: 'user_story',
          entityRow,
          requestedProject,
          idOrKey: 'FUR-S-1',
        });
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        expect((error as AppError).message).toContain('User story');
      }
    });
  });

  describe('information leak prevention', () => {
    it('should not reveal cross-workspace entities exist', () => {
      const entityRow: EntityRow = {
        projectId: otherWorkspaceProject.id,
        workspaceId: otherWorkspaceProject.workspaceId,
        keyPrefix: 'PNZ',
        issueKeyType: 'M',
        issueNumber: 1,
      };

      try {
        assertFilterEntityInProject({
          entityType: 'milestone',
          entityRow,
          requestedProject,
          idOrKey: 'PNZ-M-1',
        });
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        const appError = error as AppError;
        expect(appError.code).toBe('ENTITY_NOT_FOUND');
        expect(appError.statusCode).toBe(404);
        expect(appError.message).toContain('not found in project');
        expect(appError.message).not.toContain('does not belong to');
      }
    });
  });
});
