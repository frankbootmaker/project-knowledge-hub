import { z } from 'zod';

export const projectStatusSchema = z.enum([
  'idea',
  'planned',
  'active',
  'maintenance',
  'paused',
  'completed',
  'archived',
]);

export const systemStatusSchema = z.enum([
  'proposed',
  'experimental',
  'active',
  'degraded',
  'maintenance',
  'deprecated',
  'retired',
  'archived',
]);

export const membershipRoleSchema = z.enum([
  'system_admin',
  'workspace_admin',
  'maintainer',
  'reader',
  'mcp_client',
]);

export const userStatusSchema = z.enum(['active', 'disabled', 'invited']);

export type ProjectStatus = z.infer<typeof projectStatusSchema>;
export type SystemStatus = z.infer<typeof systemStatusSchema>;
export type MembershipRole = z.infer<typeof membershipRoleSchema>;
export type UserStatus = z.infer<typeof userStatusSchema>;

export class AppError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly details?: unknown;

  constructor(options: {
    code: string;
    message: string;
    statusCode?: number;
    details?: unknown;
    cause?: unknown;
  }) {
    super(options.message, { cause: options.cause });
    this.name = 'AppError';
    this.code = options.code;
    this.statusCode = options.statusCode ?? 500;
    this.details = options.details;
  }
}
