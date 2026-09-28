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
  systemItDetailsPatchSchema,
  buildItDetailsPatch,
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

describe('systemItDetailsPatchSchema', () => {
  it('parses null values to remove keys', () => {
    const patch = systemItDetailsPatchSchema.parse({
      vendor: null,
      hostname: 'example.com',
    });
    expect(patch).toEqual({
      vendor: null,
      hostname: 'example.com',
    });
  });

  it('parses empty arrays', () => {
    const patch = systemItDetailsPatchSchema.parse({
      ports: [],
      ipAddresses: [],
    });
    expect(patch).toEqual({
      ports: [],
      ipAddresses: [],
    });
  });

  it('rejects invalid enum values', () => {
    expect(() =>
      systemItDetailsPatchSchema.parse({
        deploymentModel: 'invalid_model',
      }),
    ).toThrow();
  });

  it('rejects out-of-range port numbers', () => {
    expect(() =>
      systemItDetailsPatchSchema.parse({
        ports: [{ port: 99999 }],
      }),
    ).toThrow();
  });

  it('strips unknown keys', () => {
    const patch = systemItDetailsPatchSchema.parse({
      hostname: 'db.example',
      unknownField: 'should be removed',
    });
    expect(patch).toEqual({
      hostname: 'db.example',
    });
    expect('unknownField' in patch).toBe(false);
  });

  it('accepts valid nullable and optional fields', () => {
    const patch = systemItDetailsPatchSchema.parse({
      hostname: 'web.example',
      vendor: null,
      deploymentModel: 'kubernetes',
      dataClassification: null,
    });
    expect(patch).toEqual({
      hostname: 'web.example',
      vendor: null,
      deploymentModel: 'kubernetes',
      dataClassification: null,
    });
  });
});

describe('buildItDetailsPatch', () => {
  it('converts empty strings to null', () => {
    const patch = buildItDetailsPatch({
      hostname: '',
      vendor: 'MySQL',
    });
    expect(patch).toEqual({
      hostname: null,
      vendor: 'MySQL',
    });
  });

  it('trims non-empty strings', () => {
    const patch = buildItDetailsPatch({
      hostname: '  db.example.com  ',
      vendor: '  PostgreSQL  ',
    });
    expect(patch).toEqual({
      hostname: 'db.example.com',
      vendor: 'PostgreSQL',
    });
  });

  it('preserves unchanged fields by not including them', () => {
    const patch = buildItDetailsPatch({
      hostname: 'web.example',
    });
    expect(patch).toEqual({
      hostname: 'web.example',
    });
    expect('vendor' in patch).toBe(false);
    expect('primaryUrl' in patch).toBe(false);
  });

  it('converts empty deployment model to null', () => {
    const patch = buildItDetailsPatch({
      deploymentModel: '',
    });
    expect(patch).toEqual({
      deploymentModel: null,
    });
  });

  it('converts empty data classification to null', () => {
    const patch = buildItDetailsPatch({
      dataClassification: '',
    });
    expect(patch).toEqual({
      dataClassification: null,
    });
  });

  it('handles all fields together', () => {
    const patch = buildItDetailsPatch({
      primaryUrl: 'https://app.example.com',
      hostname: '',
      vendor: '  Acme Corp  ',
      deploymentModel: 'kubernetes',
      supportContact: '',
      documentationUrl: 'https://docs.example.com',
      dataClassification: 'internal',
    });
    expect(patch).toEqual({
      primaryUrl: 'https://app.example.com',
      hostname: null,
      vendor: 'Acme Corp',
      deploymentModel: 'kubernetes',
      supportContact: null,
      documentationUrl: 'https://docs.example.com',
      dataClassification: 'internal',
    });
  });
});
