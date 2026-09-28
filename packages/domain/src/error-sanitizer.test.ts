import { describe, test, expect } from 'vitest';
import { sanitizeError } from './error-sanitizer.js';
import { AppError } from './index.js';

describe('sanitizeError', () => {
  test('passes through AppError unchanged', () => {
    const appError = new AppError({
      code: 'CUSTOM_ERROR',
      message: 'Custom error message',
      statusCode: 400,
    });

    const result = sanitizeError(appError);

    expect(result.statusCode).toBe(400);
    expect(result.code).toBe('CUSTOM_ERROR');
    expect(result.message).toBe('Custom error message');
    expect(result.correlationId).toBeUndefined();
    expect(result.logPayload).toBeUndefined();
  });

  test('sanitizes DrizzleQueryError with invalid date (22007)', () => {
    const postgresError = Object.assign(new Error('date/time field value out of range'), {
      code: '22007',
      table_name: 'project_tasks',
      column_name: 'due_date',
      detail: 'Invalid date value',
    });

    const drizzleError = Object.assign(
      new Error('Failed query: insert into "project_tasks" (title, due_date) values ($1, $2)\nparams: ["Test", "2026-02-30"]'),
      {
        cause: postgresError,
      },
    );
    Object.defineProperty(drizzleError, 'name', { value: 'DrizzleQueryError' });

    const result = sanitizeError(drizzleError);

    expect(result.statusCode).toBe(400);
    expect(result.code).toBe('INVALID_DATE');
    expect(result.message).toBe('Invalid date or datetime value');
    expect(result.correlationId).toBeDefined();
    expect(result.logPayload).toBeDefined();
    expect(result.logPayload?.dbCode).toBe('22007');
    expect(result.logPayload?.table_name).toBe('project_tasks');
    
    // Ensure no SQL or params leak
    expect(result.message).not.toContain('insert into');
    expect(result.message).not.toContain('params:');
    expect(result.message).not.toContain('2026-02-30');
    expect(result.message).not.toContain('project_tasks');
  });

  test('sanitizes DrizzleQueryError with invalid datetime (22008)', () => {
    const postgresError = Object.assign(new Error('datetime field out of range'), {
      code: '22008',
      table_name: 'project_milestones',
    });

    const drizzleError = Object.assign(
      new Error('Failed query: insert into "project_milestones" ...\nparams: ...'),
      {
        cause: postgresError,
      },
    );

    const result = sanitizeError(drizzleError);

    expect(result.statusCode).toBe(400);
    expect(result.code).toBe('INVALID_DATE');
    expect(result.message).toBe('Invalid date or datetime value');
    expect(result.correlationId).toBeDefined();
  });

  test('sanitizes DrizzleQueryError with unique violation (23505)', () => {
    const postgresError = Object.assign(
      new Error('duplicate key value violates unique constraint'),
      {
        code: '23505',
        constraint_name: 'users_email_unique',
        table_name: 'users',
      },
    );

    const drizzleError = Object.assign(
      new Error('Failed query: insert into "users" (email) values ($1)\nparams: ["test@example.com"]'),
      {
        cause: postgresError,
      },
    );

    const result = sanitizeError(drizzleError);

    expect(result.statusCode).toBe(409);
    expect(result.code).toBe('DUPLICATE_ENTRY');
    expect(result.message).toBe('A record with this value already exists');
    expect(result.correlationId).toBeDefined();
    expect(result.logPayload?.constraint_name).toBe('users_email_unique');
    
    // Ensure no SQL or constraint name in message
    expect(result.message).not.toContain('users_email_unique');
    expect(result.message).not.toContain('insert into');
  });

  test('sanitizes DrizzleQueryError with foreign key violation (23503)', () => {
    const postgresError = Object.assign(new Error('foreign key constraint violated'), {
      code: '23503',
      constraint_name: 'tasks_project_id_fkey',
      table_name: 'project_tasks',
    });

    const drizzleError = Object.assign(
      new Error('Failed query: insert into "project_tasks" ...\nparams: ...'),
      {
        cause: postgresError,
      },
    );

    const result = sanitizeError(drizzleError);

    expect(result.statusCode).toBe(400);
    expect(result.code).toBe('INVALID_REFERENCE');
    expect(result.message).toBe('Referenced record does not exist');
    expect(result.correlationId).toBeDefined();
  });

  test('sanitizes DrizzleQueryError with invalid text representation (22P02)', () => {
    const postgresError = Object.assign(new Error('invalid input syntax'), {
      code: '22P02',
      table_name: 'users',
    });

    const drizzleError = Object.assign(
      new Error('Failed query: ...\nparams: ...'),
      {
        cause: postgresError,
      },
    );

    const result = sanitizeError(drizzleError);

    expect(result.statusCode).toBe(400);
    expect(result.code).toBe('INVALID_INPUT');
    expect(result.message).toBe('Invalid input format');
    expect(result.correlationId).toBeDefined();
  });

  test('sanitizes DrizzleQueryError with unknown postgres error code', () => {
    const postgresError = Object.assign(new Error('Some other database error'), {
      code: '99999',
      table_name: 'some_table',
    });

    const drizzleError = Object.assign(
      new Error('Failed query: ...\nparams: ...'),
      {
        cause: postgresError,
      },
    );

    const result = sanitizeError(drizzleError);

    expect(result.statusCode).toBe(500);
    expect(result.code).toBe('INTERNAL_ERROR');
    expect(result.message).toContain('Internal error (ref:');
    expect(result.correlationId).toBeDefined();
    expect(result.logPayload).toBeDefined();
  });

  test('sanitizes direct PostgresError without Drizzle wrapper', () => {
    const postgresError = Object.assign(new Error('date/time field value out of range'), {
      code: '22007',
      table_name: 'project_tasks',
    });

    const result = sanitizeError(postgresError);

    expect(result.statusCode).toBe(400);
    expect(result.code).toBe('INVALID_DATE');
    expect(result.correlationId).toBeDefined();
  });

  test('walks cause chain to find database error (nested)', () => {
    const postgresError = Object.assign(new Error('date error'), {
      code: '22007',
    });

    const wrapper1 = Object.assign(new Error('Wrapper 1'), {
      cause: postgresError,
    });

    const wrapper2 = Object.assign(new Error('Wrapper 2'), {
      cause: wrapper1,
    });

    const result = sanitizeError(wrapper2);

    expect(result.statusCode).toBe(400);
    expect(result.code).toBe('INVALID_DATE');
    expect(result.correlationId).toBeDefined();
  });

  test('sanitizes generic errors with correlation ID', () => {
    const genericError = new Error('Something went wrong');

    const result = sanitizeError(genericError);

    expect(result.statusCode).toBe(500);
    expect(result.code).toBe('INTERNAL_ERROR');
    expect(result.message).toContain('Internal error (ref:');
    expect(result.correlationId).toBeDefined();
    expect(result.logPayload).toBeDefined();
  });

  test('does not leak SQL or params for any database error', () => {
    const postgresError = Object.assign(
      new Error('date/time field value out of range'),
      {
        code: '22007',
        table_name: 'project_tasks',
        detail: 'Invalid date 2026-02-30',
      },
    );

    const drizzleError = Object.assign(
      new Error('Failed query: insert into "project_tasks" (title, due_date, project_id) values ($1, $2, $3)\nparams: ["Test Task", "2026-02-30", "550e8400-e29b-41d4-a716-446655440000"]'),
      {
        cause: postgresError,
      },
    );

    const result = sanitizeError(drizzleError);

    expect(result.message).not.toContain('Failed query');
    expect(result.message).not.toContain('insert into');
    expect(result.message).not.toContain('params:');
    expect(result.message).not.toContain('2026-02-30');
    expect(result.message).not.toContain('550e8400');
    expect(result.message).not.toContain('project_tasks');
    expect(result.message).toBe('Invalid date or datetime value');
  });

  test('generates unique correlation IDs', () => {
    const error1 = new Error('Error 1');
    const error2 = new Error('Error 2');

    const result1 = sanitizeError(error1);
    const result2 = sanitizeError(error2);

    expect(result1.correlationId).toBeDefined();
    expect(result2.correlationId).toBeDefined();
    expect(result1.correlationId).not.toBe(result2.correlationId);
  });

  test('logs full error message in logPayload', () => {
    const drizzleError = Object.assign(
      new Error('Failed query: insert into "project_tasks" (title, due_date) values ($1, $2)\nparams: ["Test", "2026-02-30"]'),
      {
        cause: Object.assign(new Error('date error'), {
          code: '22007',
          table_name: 'project_tasks',
        }),
      },
    );

    const result = sanitizeError(drizzleError);

    expect(result.logPayload?.errorMessage).toContain('Failed query');
    expect(result.logPayload?.errorMessage).toContain('params:');
    expect(result.logPayload?.table_name).toBe('project_tasks');
    
    // But the client message is still clean
    expect(result.message).toBe('Invalid date or datetime value');
  });
});
