import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { toJsonSchemaCompat } from '@modelcontextprotocol/sdk/server/zod-json-schema-compat.js';
import { jsonSchemaHasClosedObjects, relaxClosedJsonSchema } from './open-output-schema.js';

describe('relaxClosedJsonSchema', () => {
  it('removes additionalProperties: false at every depth', () => {
    const schema = z.object({
      project: z
        .object({
          id: z.string(),
          health: z
            .object({
              overall: z.enum(['green', 'amber', 'red']),
            })
            .strict(),
        })
        .strict(),
    });
    const json = toJsonSchemaCompat(schema, { pipeStrategy: 'output' });
    expect(jsonSchemaHasClosedObjects(json)).toBe(true);
    const relaxed = relaxClosedJsonSchema(json);
    expect(jsonSchemaHasClosedObjects(relaxed)).toBe(false);
    expect(JSON.stringify(relaxed)).not.toContain('"additionalProperties":false');
    expect(JSON.stringify(relaxed)).not.toContain('"additionalProperties":true');
  });
});
