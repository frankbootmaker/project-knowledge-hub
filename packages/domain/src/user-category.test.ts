import { describe, it, expect } from 'vitest';
import { userTypeSchema } from '@project-knowledge-hub/domain';

describe('User category (userType)', () => {
  describe('Schema validation', () => {
    it('should accept "human" as valid user type', () => {
      const result = userTypeSchema.safeParse('human');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe('human');
      }
    });

    it('should accept "system" as valid user type', () => {
      const result = userTypeSchema.safeParse('system');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe('system');
      }
    });

    it('should reject invalid user types', () => {
      const result = userTypeSchema.safeParse('invalid');
      expect(result.success).toBe(false);
    });

    it('should reject null', () => {
      const result = userTypeSchema.safeParse(null);
      expect(result.success).toBe(false);
    });

    it('should reject undefined', () => {
      const result = userTypeSchema.safeParse(undefined);
      expect(result.success).toBe(false);
    });
  });
});
