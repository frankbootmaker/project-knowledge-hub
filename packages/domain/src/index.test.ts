import { describe, expect, it } from 'vitest';
import {
  AppError,
  epicStatusSchema,
  milestoneStatusSchema,
  projectStakeholderRoleSchema,
  projectStatusSchema,
  raciRoleSchema,
  stakeholderCompetenciesSchema,
  stakeholderStaffingStatusSchema,
  normalizeSystemCriticality,
  systemItDetailsSchema,
  taskActivityTypeSchema,
  taskStatusSchema,
  userStoryStatusSchema,
} from './index.js';

describe('domain foundations', () => {
  it('validates project statuses', () => {
    expect(projectStatusSchema.parse('active')).toBe('active');
  });

  it('validates project delivery statuses and RACI roles', () => {
    expect(milestoneStatusSchema.parse('planned')).toBe('planned');
    expect(taskStatusSchema.parse('in_progress')).toBe('in_progress');
    expect(raciRoleSchema.parse('A')).toBe('A');
    expect(epicStatusSchema.parse('active')).toBe('active');
    expect(userStoryStatusSchema.parse('done')).toBe('done');
    expect(taskActivityTypeSchema.parse('handoff')).toBe('handoff');
  });

  it('validates project stakeholder roles', () => {
    expect(projectStakeholderRoleSchema.parse('sponsor')).toBe('sponsor');
    expect(projectStakeholderRoleSchema.parse('tech_lead')).toBe('tech_lead');
  });

  it('normalizes stakeholder competencies (trim, dedupe, skillId)', () => {
    expect(stakeholderStaffingStatusSchema.parse('open')).toBe('open');
    const parsed = stakeholderCompetenciesSchema.parse([
      { name: '  TypeScript  ', skillId: null },
      { name: 'typescript' },
      { name: 'PostgreSQL' },
    ]);
    expect(parsed).toEqual([
      { name: 'TypeScript', skillId: null },
      { name: 'PostgreSQL', skillId: null },
    ]);
    expect(() =>
      stakeholderCompetenciesSchema.parse([{ name: '' }]),
    ).toThrow();
    expect(() =>
      stakeholderCompetenciesSchema.parse(
        Array.from({ length: 41 }, (_, i) => ({ name: `skill-${i}` })),
      ),
    ).toThrow();
  });

  it('parses system IT details and normalizes criticality', () => {
    expect(normalizeSystemCriticality('High')).toBe('high');
    expect(normalizeSystemCriticality('crit')).toBe('critical');
    expect(normalizeSystemCriticality('unknown')).toBeNull();
    const details = systemItDetailsSchema.parse({
      hostname: 'app.example.com',
      primaryUrl: 'https://app.example.com',
      deploymentModel: 'kubernetes',
      dataClassification: 'internal',
      ipAddresses: ['10.0.0.1'],
      unknownField: 'drop-me',
    });
    expect(details.hostname).toBe('app.example.com');
    expect(details.deploymentModel).toBe('kubernetes');
    expect((details as { unknownField?: string }).unknownField).toBeUndefined();
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
