import { describe, expect, it } from 'vitest';
import { isProjectStage, projectStageTone } from './project-stage';

describe('project stage badge', () => {
  it('uses a warning tone for idea and success for active', () => {
    expect(projectStageTone('idea')).toBe('warn');
    expect(projectStageTone('active')).toBe('success');
    expect(isProjectStage('idea')).toBe(true);
    expect(isProjectStage('draft')).toBe(false);
  });
});
