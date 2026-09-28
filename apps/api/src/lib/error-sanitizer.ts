import { randomUUID } from 'node:crypto';
import { AppError } from '@project-knowledge-hub/domain';
import type { FastifyBaseLogger } from 'fastify';

type DatabaseError = Error & {
  code?: string;
  table?: string;
  column?: string;
  constraint?: string;
  detail?: string;
  hint?: string;
  position?: string;
  internalPosition?: string;
  internalQuery?: string;
  where?: string;
  schema?: string;
  file?: string;
  line?: string;
  routine?: string;
};

function isDatabaseError(error: unknown): error is DatabaseError {
  return (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    (error.constructor.name === 'DatabaseError' ||
      error.constructor.name === 'DrizzleError' ||
      'table' in error ||
      'constraint' in error)
  );
}

export function sanitizeError(
  error: unknown,
  logger: FastifyBaseLogger,
): { statusCode: number; code: string; message: string; correlationId?: string } {
  if (error instanceof AppError) {
    return {
      statusCode: error.statusCode,
      code: error.code,
      message: error.message,
    };
  }

  if (isDatabaseError(error)) {
    const correlationId = randomUUID();
    logger.error(
      {
        err: error,
        correlationId,
        dbCode: error.code,
        table: error.table,
        constraint: error.constraint,
        detail: error.detail,
      },
      'Database error',
    );

    const pgCode = error.code;
    switch (pgCode) {
      case '22007':
      case '22008':
        return {
          statusCode: 400,
          code: 'INVALID_DATE',
          message: 'Invalid date or datetime value',
          correlationId,
        };
      case '22P02':
        return {
          statusCode: 400,
          code: 'INVALID_INPUT',
          message: 'Invalid input format',
          correlationId,
        };
      case '23505':
        return {
          statusCode: 409,
          code: 'DUPLICATE_ENTRY',
          message: 'A record with this value already exists',
          correlationId,
        };
      case '23503':
        return {
          statusCode: 400,
          code: 'INVALID_REFERENCE',
          message: 'Referenced record does not exist',
          correlationId,
        };
      default:
        return {
          statusCode: 500,
          code: 'INTERNAL_ERROR',
          message: `Internal error (ref: ${correlationId})`,
          correlationId,
        };
    }
  }

  const correlationId = randomUUID();
  logger.error({ err: error, correlationId }, 'Unhandled error');
  return {
    statusCode: 500,
    code: 'INTERNAL_ERROR',
    message: `Internal error (ref: ${correlationId})`,
    correlationId,
  };
}
