import { describe, expect, it } from 'vitest';
import {
  AppError,
  milestoneStatusSchema,
  projectStakeholderRoleSchema,
  projectStatusSchema,
  raciRoleSchema,
  taskStatusSchema,
} from './index.js';

describe('domain foundations', () => {
  it('validates project statuses', () => {
    expect(projectStatusSchema.parse('active')).toBe('active');
  });

  it('validates project delivery statuses and RACI roles', () => {
    expect(milestoneStatusSchema.parse('planned')).toBe('planned');
    expect(taskStatusSchema.parse('in_progress')).toBe('in_progress');
    expect(raciRoleSchema.parse('A')).toBe('A');
  });

  it('validates project stakeholder roles', () => {
    expect(projectStakeholderRoleSchema.parse('sponsor')).toBe('sponsor');
    expect(projectStakeholderRoleSchema.parse('tech_lead')).toBe('tech_lead');
  });

  it('creates typed application errors', () => {
    const error = new AppError({
      code: 'TEST_ERROR',
      message: 'example',
      statusCode: 400,
    });
    expect(error.code).toBe('TEST_ERROR');
    expect(error.statusCode).toBe(400);
  });
});
