import { describe, expect, it } from 'vitest';
import { deliveryLinkEntityTypeSchema } from './index.js';

describe('deliveryLinkEntityTypeSchema', () => {
  it('accepts milestone and keeps bugs on task', () => {
    expect(deliveryLinkEntityTypeSchema.parse('milestone')).toBe('milestone');
    expect(deliveryLinkEntityTypeSchema.parse('task')).toBe('task');
    expect(deliveryLinkEntityTypeSchema.safeParse('bug').success).toBe(false);
    expect(deliveryLinkEntityTypeSchema.safeParse('raid').success).toBe(false);
  });
});
