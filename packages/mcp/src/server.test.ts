import { describe, test, expect, vi } from 'vitest';
import { toMcpErrorResult } from './server.js';
import { AppError } from '@project-knowledge-hub/domain';

describe('toMcpErrorResult', () => {
  test('AppError message passes through verbatim', () => {
    const appError = new AppError({
      code: 'PROJECT_NOT_FOUND',
      message: 'Project not found',
      statusCode: 404,
    });

    const result = toMcpErrorResult(appError);

    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(1);
    expect(result.content[0]?.type).toBe('text');
    expect(result.content[0]?.text).toBe('Project not found');
  });

  test('DrizzleQueryError-like error is sanitized', () => {
    const postgresError = Object.assign(new Error('date/time field value out of range'), {
      code: '22007',
      table_name: 'project_tasks',
    });

    const drizzleError = Object.assign(
      new Error('Failed query: insert into "project_tasks" (title, due_date) values ($1, $2)\nparams: ["Test", "2026-02-30"]'),
      {
        cause: postgresError,
      },
    );

    const result = toMcpErrorResult(drizzleError);

    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(1);
    const text = result.content[0]?.text || '';
    
    // Should not contain SQL, params, or table names
    expect(text).not.toContain('Failed query');
    expect(text).not.toContain('insert into');
    expect(text).not.toContain('params:');
    expect(text).not.toContain('2026-02-30');
    expect(text).not.toContain('project_tasks');
    
    // Should contain clean error message
    expect(text).toBe('Invalid date or datetime value');
  });

  test('plain Error does not expose error message', () => {
    const error = new Error('boom');

    const result = toMcpErrorResult(error);

    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(1);
    const text = result.content[0]?.text || '';
    
    // Should not contain the error message
    expect(text).not.toContain('boom');
    
    // Should be a generic internal error
    expect(text).toContain('Internal error (ref:');
  });

  test('logs to provided logger', () => {
    const mockLogger = {
      error: vi.fn(),
    };

    const error = new Error('database connection failed');
    toMcpErrorResult(error, mockLogger);

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        err: error,
        correlationId: expect.any(String),
      }),
      'MCP tool error',
    );
  });

  test('logs DrizzleQueryError with SQL details', () => {
    const mockLogger = {
      error: vi.fn(),
    };

    const postgresError = Object.assign(new Error('unique violation'), {
      code: '23505',
      constraint_name: 'users_email_unique',
      table_name: 'users',
    });

    const drizzleError = Object.assign(
      new Error('Failed query: insert into "users" (email) values ($1)\nparams: ["test@example.com"]'),
      {
        cause: postgresError,
      },
    );

    toMcpErrorResult(drizzleError, mockLogger);

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        err: drizzleError,
        correlationId: expect.any(String),
        dbCode: '23505',
        constraint_name: 'users_email_unique',
        table_name: 'users',
      }),
      'MCP tool error',
    );
  });

  test('falls back to console.error when no logger provided', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const error = new Error('something went wrong');
    toMcpErrorResult(error);

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[MCP Error]',
      expect.objectContaining({
        err: error,
        correlationId: expect.any(String),
      }),
    );

    consoleErrorSpy.mockRestore();
  });
});
