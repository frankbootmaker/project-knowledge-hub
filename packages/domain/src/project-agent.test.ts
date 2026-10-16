import { describe, expect, it } from 'vitest';
import { AppError } from './index.js';
import {
  assertMcpProjectStageChange,
  buildProjectMetadata,
  projectNamesAreSimilar,
} from './project-agent.js';

describe('MCP project stage', () => {
  it('refuses to promote idea to active', () => {
    expect(() => assertMcpProjectStageChange('idea', 'active')).toThrow(AppError);
    try {
      assertMcpProjectStageChange('idea', 'active');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe('PROJECT_STAGE_FORBIDDEN');
      expect((error as AppError).message).toContain('idea');
      expect((error as AppError).message).toContain('active');
    }
  });

  it('allows a no-op and a non-promoting change', () => {
    expect(assertMcpProjectStageChange('idea', 'idea')).toBe('idea');
    expect(assertMcpProjectStageChange('active', 'paused')).toBe('paused');
  });
});

describe('project name similarity', () => {
  it('matches the same name, reordered words, and a small typo', () => {
    expect(projectNamesAreSimilar('Platform Renewal', 'platform renewal')).toBe(true);
    expect(projectNamesAreSimilar('Platform Renewal', 'Renewal Platform')).toBe(true);
    expect(projectNamesAreSimilar('Platform Renewal', 'Platform Renewals')).toBe(true);
  });

  it('does not match unrelated names', () => {
    expect(projectNamesAreSimilar('Platform Renewal', 'Billing Export')).toBe(false);
    expect(projectNamesAreSimilar('Alpha', 'Beta')).toBe(false);
  });
});

describe('project metadata guide', () => {
  it('tells agents that MCP creates stay in idea', () => {
    const guide = buildProjectMetadata();
    expect(guide.createProject.mcpWriteConstraints.stage).toBe('idea');
    expect(guide.createProject.requiredFields).toEqual(['workspaceId', 'name']);
    expect(guide.updateProject.stageTransitions.idea).toEqual([]);
  });
});