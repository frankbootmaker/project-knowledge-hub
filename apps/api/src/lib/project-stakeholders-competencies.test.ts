import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { stakeholderCompetenciesSchema } from '@project-knowledge-hub/domain';

/** Mirrors apps/api/src/routes/project-stakeholders competenciesBodySchema. */
const competenciesBodySchema = z
  .union([
    stakeholderCompetenciesSchema,
    z.array(z.string().trim().min(1).max(80)).max(40),
  ])
  .optional()
  .transform((value) => {
    if (value === undefined) return undefined;
    if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
      return stakeholderCompetenciesSchema.parse(
        value.map((name) => ({ name, skillId: null })),
      );
    }
    return stakeholderCompetenciesSchema.parse(value);
  });

describe('stakeholder competencies API body', () => {
  it('accepts string tags and maps skillId null', () => {
    expect(competenciesBodySchema.parse(['TypeScript', 'PostgreSQL'])).toEqual([
      { name: 'TypeScript', skillId: null },
      { name: 'PostgreSQL', skillId: null },
    ]);
  });

  it('accepts objects and dedupes names', () => {
    expect(
      competenciesBodySchema.parse([
        { name: 'Go', skillId: null },
        { name: 'go' },
      ]),
    ).toEqual([{ name: 'Go', skillId: null }]);
  });

  it('allows omitting competencies', () => {
    expect(competenciesBodySchema.parse(undefined)).toBeUndefined();
  });
});
