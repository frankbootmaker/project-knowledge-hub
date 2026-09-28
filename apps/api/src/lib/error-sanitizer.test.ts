import { describe, test, expect, vi, beforeEach } from 'vitest';
import { sanitizeError } from './error-sanitizer.js';
import { AppError } from '@project-knowledge-hub/domain';
import type { FastifyBaseLogger } from 'fastify';

describe('sanitizeError', () => {
  let mockLogger: FastifyBaseLogger;

  beforeEach(() => {
    mockLogger = {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
      fatal: vi.fn(),
      trace: vi.fn(),
      silent: vi.fn(),
      child: vi.fn(() => mockLogger),
      level: 'info',
    } as unknown as FastifyBaseLogger;
  });

  test('passes through AppError unchanged', () => {
    const appError = new AppError({
      code: 'CUSTOM_ERROR',
      message: 'Custom error message',
      statusCode: 400,
    });

    const result = sanitizeError(appError, mockLogger);

    expect(result.statusCode).toBe(400);
    expect(result.code).toBe('CUSTOM_ERROR');
    expect(result.message).toBe('Custom error message');
    expect(result.correlationId).toBeUndefined();
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  test('sanitizes database invalid date error (22007)', () => {
    const dbError = Object.assign(new Error('date/time field value out of range'), {
      code: '22007',
      table: 'project_tasks',
      column: 'due_date',
      detail: 'Invalid date value',
    });

    const result = sanitizeError(dbError, mockLogger);

    expect(result.statusCode).toBe(400);
    expect(result.code).toBe('INVALID_DATE');
    expect(result.message).toBe('Invalid date or datetime value');
    expect(result.correlationId).toBeDefined();
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        dbCode: '22007',
        correlationId: result.correlationId,
      }),
      'Database error',
    );
  });

  test('sanitizes database invalid datetime error (22008)', () => {
    const dbError = Object.assign(new Error('datetime field out of range'), {
      code: '22008',
      table: 'project_tasks',
    });

    const result = sanitizeError(dbError, mockLogger);

    expect(result.statusCode).toBe(400);
    expect(result.code).toBe('INVALID_DATE');
    expect(result.message).toBe('Invalid date or datetime value');
    expect(result.correlationId).toBeDefined();
  });

  test('sanitizes database invalid text representation error (22P02)', () => {
    const dbError = Object.assign(new Error('invalid input syntax'), {
      code: '22P02',
      table: 'users',
    });

    const result = sanitizeError(dbError, mockLogger);

    expect(result.statusCode).toBe(400);
    expect(result.code).toBe('INVALID_INPUT');
    expect(result.message).toBe('Invalid input format');
    expect(result.correlationId).toBeDefined();
  });

  test('sanitizes database unique violation error (23505)', () => {
    const dbError = Object.assign(new Error('duplicate key value violates unique constraint'), {
      code: '23505',
      constraint: 'users_email_unique',
    });

    const result = sanitizeError(dbError, mockLogger);

    expect(result.statusCode).toBe(409);
    expect(result.code).toBe('DUPLICATE_ENTRY');
    expect(result.message).toBe('A record with this value already exists');
    expect(result.correlationId).toBeDefined();
  });

  test('sanitizes database foreign key violation error (23503)', () => {
    const dbError = Object.assign(new Error('foreign key constraint violated'), {
      code: '23503',
      constraint: 'tasks_project_id_fkey',
    });

    const result = sanitizeError(dbError, mockLogger);

    expect(result.statusCode).toBe(400);
    expect(result.code).toBe('INVALID_REFERENCE');
    expect(result.message).toBe('Referenced record does not exist');
    expect(result.correlationId).toBeDefined();
  });

  test('sanitizes unknown database errors with correlation ID', () => {
    const dbError = Object.assign(new Error('Some other database error'), {
      code: '99999',
      table: 'some_table',
    });

    const result = sanitizeError(dbError, mockLogger);

    expect(result.statusCode).toBe(500);
    expect(result.code).toBe('INTERNAL_ERROR');
    expect(result.message).toContain('Internal error (ref:');
    expect(result.correlationId).toBeDefined();
    expect(mockLogger.error).toHaveBeenCalled();
  });

  test('sanitizes DrizzleError instances', () => {
    class DrizzleError extends Error {
      code = '23505';
    }

    const drizzleError = new DrizzleError('Drizzle query failed');

    const result = sanitizeError(drizzleError, mockLogger);

    expect(result.statusCode).toBe(409);
    expect(result.code).toBe('DUPLICATE_ENTRY');
    expect(result.correlationId).toBeDefined();
  });

  test('sanitizes generic errors with correlation ID', () => {
    const genericError = new Error('Something went wrong');

    const result = sanitizeError(genericError, mockLogger);

    expect(result.statusCode).toBe(500);
    expect(result.code).toBe('INTERNAL_ERROR');
    expect(result.message).toContain('Internal error (ref:');
    expect(result.correlationId).toBeDefined();
    expect(mockLogger.error).toHaveBeenCalled();
  });

  test('does not leak SQL or params in error message', () => {
    const dbError = Object.assign(
      new Error('Failed query: insert into project_tasks (title, due_date) values ($1, $2)'),
      {
        code: '22007',
        table: 'project_tasks',
        detail: 'params: ["Test Task", "2026-02-30"]',
      },
    );

    const result = sanitizeError(dbError, mockLogger);

    expect(result.message).not.toContain('insert into');
    expect(result.message).not.toContain('params:');
    expect(result.message).not.toContain('2026-02-30');
    expect(result.message).toBe('Invalid date or datetime value');
  });

  test('generates unique correlation IDs', () => {
    const error1 = new Error('Error 1');
    const error2 = new Error('Error 2');

    const result1 = sanitizeError(error1, mockLogger);
    const result2 = sanitizeError(error2, mockLogger);

    expect(result1.correlationId).toBeDefined();
    expect(result2.correlationId).toBeDefined();
    expect(result1.correlationId).not.toBe(result2.correlationId);
  });
});
