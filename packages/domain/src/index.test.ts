import { describe, expect, it } from 'vitest';
import { AppError, projectStatusSchema } from './index.js';

describe('domain foundations', () => {
  it('validates project statuses', () => {
    expect(projectStatusSchema.parse('active')).toBe('active');
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
