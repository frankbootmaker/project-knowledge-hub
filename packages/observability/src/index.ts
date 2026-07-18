import pino, { type Logger, type LoggerOptions } from 'pino';

export type CreateLoggerOptions = {
  name: string;
  level?: string;
  pretty?: boolean;
};

export function createLogger(options: CreateLoggerOptions): Logger {
  const loggerOptions: LoggerOptions = {
    name: options.name,
    level: options.level ?? 'info',
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: [
        'password',
        'token',
        'authorization',
        'DATABASE_URL',
        'REDIS_URL',
        'req.headers.authorization',
        'req.headers.cookie',
      ],
      censor: '[Redacted]',
    },
  };

  if (options.pretty) {
    return pino({
      ...loggerOptions,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
        },
      },
    });
  }

  return pino(loggerOptions);
}

export type { Logger };
