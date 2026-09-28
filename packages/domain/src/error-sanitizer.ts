import { randomUUID } from 'node:crypto';
import { AppError } from './index.js';

type PostgresError = Error & {
  code?: string;
  table_name?: string;
  column_name?: string;
  constraint_name?: string;
  detail?: string;
  hint?: string;
  position?: string;
  internalPosition?: string;
  internalQuery?: string;
  where?: string;
  schema_name?: string;
  file?: string;
  line?: string;
  routine?: string;
};

type DatabaseErrorInfo = {
  code: string;
  table_name?: string;
  column_name?: string;
  constraint_name?: string;
  detail?: string;
};

/**
 * Walk the error cause chain to find a database error with a 5-character SQLSTATE code.
 * Handles drizzle-orm's DrizzleQueryError (which wraps the driver error in .cause)
 * and direct postgres.js PostgresError instances.
 */
function findDatabaseError(error: unknown, maxDepth = 5): DatabaseErrorInfo | null {
  let current: unknown = error;
  let depth = 0;

  while (current && depth < maxDepth) {
    if (
      current &&
      typeof current === 'object' &&
      'code' in current &&
      typeof current.code === 'string' &&
      current.code.length === 5
    ) {
      const dbError = current as PostgresError;
      return {
        code: dbError.code!,
        table_name: dbError.table_name,
        column_name: dbError.column_name,
        constraint_name: dbError.constraint_name,
        detail: dbError.detail,
      };
    }

    if (current && typeof current === 'object' && 'cause' in current) {
      current = current.cause;
      depth++;
    } else {
      break;
    }
  }

  return null;
}

export type SanitizedError = {
  statusCode: number;
  code: string;
  message: string;
  correlationId?: string;
  logPayload?: Record<string, unknown>;
};

/**
 * Sanitize errors for safe return to clients.
 * - AppError: returned as-is (already safe)
 * - Database errors: mapped to clean 4xx/5xx with correlation ID, full details logged
 * - Other errors: generic 500 with correlation ID
 * 
 * Never returns raw SQL, params, table names, or internal details to clients.
 */
export function sanitizeError(error: unknown): SanitizedError {
  if (error instanceof AppError) {
    return {
      statusCode: error.statusCode,
      code: error.code,
      message: error.message,
    };
  }

  const dbError = findDatabaseError(error);
  if (dbError) {
    const correlationId = randomUUID();
    const logPayload = {
      correlationId,
      dbCode: dbError.code,
      table_name: dbError.table_name,
      constraint_name: dbError.constraint_name,
      column_name: dbError.column_name,
      detail: dbError.detail,
      errorMessage: error instanceof Error ? error.message : String(error),
    };

    switch (dbError.code) {
      case '22007':
      case '22008':
        return {
          statusCode: 400,
          code: 'INVALID_DATE',
          message: 'Invalid date or datetime value',
          correlationId,
          logPayload,
        };
      case '22P02':
        return {
          statusCode: 400,
          code: 'INVALID_INPUT',
          message: 'Invalid input format',
          correlationId,
          logPayload,
        };
      case '23505':
        return {
          statusCode: 409,
          code: 'DUPLICATE_ENTRY',
          message: 'A record with this value already exists',
          correlationId,
          logPayload,
        };
      case '23503':
        return {
          statusCode: 400,
          code: 'INVALID_REFERENCE',
          message: 'Referenced record does not exist',
          correlationId,
          logPayload,
        };
      default:
        return {
          statusCode: 500,
          code: 'INTERNAL_ERROR',
          message: `Internal error (ref: ${correlationId})`,
          correlationId,
          logPayload,
        };
    }
  }

  const correlationId = randomUUID();
  const logPayload = {
    correlationId,
    errorMessage: error instanceof Error ? error.message : String(error),
    errorName: error instanceof Error ? error.constructor.name : typeof error,
  };

  return {
    statusCode: 500,
    code: 'INTERNAL_ERROR',
    message: `Internal error (ref: ${correlationId})`,
    correlationId,
    logPayload,
  };
}
