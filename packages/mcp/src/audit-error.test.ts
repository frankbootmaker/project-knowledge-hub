import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { AppError } from '@project-knowledge-hub/domain';
import {
  MCP_AUDIT_ERROR_MESSAGE_MAX,
  buildMcpToolAuditMetadata,
  classifyMcpToolError,
  projectRecentAuditError,
  sanitizeAuditErrorMessage,
} from './audit-error.js';

const SECRET = 'kh_super_secret_token_value';
const POSTGRES = 'postgres://user:secret@db/knowledge';

function zodValidationMessage(toolName: string): string {
  const parsed = z
    .object({
      projectId: z.string().uuid(),
      entityId: z.string().min(1),
    })
    .strict()
    .safeParse({
      projectId: 'not-a-uuid',
      leaked: SECRET,
      note: `bearer ${SECRET}`,
      [SECRET]: 'x',
    });
  if (parsed.success) throw new Error('expected validation failure');
  return `Input validation error: Invalid arguments for tool ${toolName}: ${parsed.error.message}`;
}

describe('classifyMcpToolError', () => {
  test('maps status and code onto the four audit types', () => {
    expect(classifyMcpToolError({ code: -32602, message: 'Invalid params' })).toBe('validation');
    expect(
      classifyMcpToolError(new AppError({
        code: 'VALIDATION_ERROR',
        message: 'Invalid project stage',
        statusCode: 400,
      })),
    ).toBe('validation');
    expect(
      classifyMcpToolError(new AppError({
        code: 'PROJECT_NOT_FOUND',
        message: 'Project not found',
        statusCode: 404,
      })),
    ).toBe('not_found');
    expect(
      classifyMcpToolError(new AppError({
        code: 'FORBIDDEN',
        message: 'Missing required scope: monitoring:read',
        statusCode: 403,
      })),
    ).toBe('forbidden');
    expect(
      classifyMcpToolError(new AppError({
        code: 'PROJECT_STAGE_FORBIDDEN',
        message: 'MCP cannot archive a project',
        statusCode: 403,
      })),
    ).toBe('forbidden');
    expect(classifyMcpToolError(new Error(POSTGRES))).toBe('internal');
  });
});

describe('sanitizeAuditErrorMessage', () => {
  test('keeps validation paths and codes and drops argument values and tokens', () => {
    const message = sanitizeAuditErrorMessage(zodValidationMessage('list_delivery_dependencies'), 'validation');

    expect(message).toContain('list_delivery_dependencies');
    expect(message).toContain('projectId: invalid_string');
    expect(message).toContain('unrecognized_keys (leaked, note)');
    expect(message).not.toContain(SECRET);
    expect(message).not.toContain('not-a-uuid');
    expect(message).not.toContain('bearer');
    expect(message.length).toBeLessThanOrEqual(MCP_AUDIT_ERROR_MESSAGE_MAX);
  });

  test('redacts tokens and connection strings from other errors and caps length', () => {
    const raw = `Project lookup failed for ${POSTGRES} token=${SECRET} ${'x'.repeat(400)}`;
    const message = sanitizeAuditErrorMessage(raw, 'internal');

    expect(message).not.toContain(POSTGRES);
    expect(message).not.toContain(SECRET);
    expect(message).toContain('[redacted]');
    expect(message.length).toBe(MCP_AUDIT_ERROR_MESSAGE_MAX);
  });

  test('strips quoted argument values from validation text that is not Zod JSON', () => {
    const message = sanitizeAuditErrorMessage(
      `Invalid currency "${SECRET}"`,
      'validation',
    );
    expect(message).toBe('Invalid currency "[redacted]"');
    expect(message).not.toContain(SECRET);
  });
});

describe('buildMcpToolAuditMetadata', () => {
  test('records error type, client, clientInfo, and user without argument values', () => {
    const metadata = buildMcpToolAuditMetadata({
      client: {
        id: 'client-1',
        name: 'CI tester',
        actingUserId: 'user-1',
        oauthGrantId: null,
      },
      toolName: 'list_delivery_dependencies',
      ok: false,
      userName: 'Ada Lovelace',
      context: {
        error: {
          errorType: 'validation',
          message: zodValidationMessage('list_delivery_dependencies'),
        },
        clientInfo: { name: 'cursor-test', version: '1.2.3' },
        projectId: '11111111-1111-4111-8111-111111111111',
      },
    });

    expect(metadata).toMatchObject({
      clientId: 'client-1',
      clientName: 'CI tester',
      clientKind: 'api_client',
      userId: 'user-1',
      userName: 'Ada Lovelace',
      errorType: 'validation',
      clientInfo: { name: 'cursor-test', version: '1.2.3' },
      toolName: 'list_delivery_dependencies',
      ok: false,
    });
    const encoded = JSON.stringify(metadata);
    expect(encoded).not.toContain(SECRET);
    expect(encoded).not.toContain('not-a-uuid');
    expect(encoded).not.toContain('arguments');
    expect(metadata).not.toHaveProperty('arguments');
  });

  test('uses the OAuth client id as the client name and keeps the user separate', () => {
    const metadata = buildMcpToolAuditMetadata({
      client: {
        id: 'grant-1',
        name: 'Ada Lovelace',
        actingUserId: 'user-1',
        oauthGrantId: 'grant-1',
        oauthClientId: 'https://chatgpt.com/oauth/client',
      },
      toolName: 'get_project',
      ok: false,
      userName: 'Ada Lovelace',
      context: {
        error: { errorType: 'forbidden', message: 'Missing required scope: projects:read' },
      },
    });

    expect(metadata.clientKind).toBe('oauth');
    expect(metadata.clientName).toBe('https://chatgpt.com/oauth/client');
    expect(metadata.oauthClientId).toBe('https://chatgpt.com/oauth/client');
    expect(metadata.userId).toBe('user-1');
    expect(metadata.userName).toBe('Ada Lovelace');
    expect(metadata.errorType).toBe('forbidden');
  });

  test('drops clientInfo that looks like a token', () => {
    const metadata = buildMcpToolAuditMetadata({
      client: { id: 'client-1', name: 'CI' },
      toolName: 'get_project',
      ok: false,
      context: {
        error: { errorType: 'internal', message: 'Internal error (ref: abc)' },
        clientInfo: { name: `cursor ${SECRET}`, version: '1' },
      },
    });
    expect(metadata.clientInfo).toBeUndefined();
    expect(JSON.stringify(metadata)).not.toContain(SECRET);
  });
});

describe('projectRecentAuditError', () => {
  test('exposes the safe fields and re-sanitizes a stored message', () => {
    const view = projectRecentAuditError({
      id: 'evt-1',
      action: 'mcp.tool_error',
      entityType: 'mcp_tool',
      entityId: 'list_projects',
      createdAt: '2026-10-22T00:00:00.000Z',
      actorType: 'api_client',
      actorId: 'client-1',
      metadata: {
        clientId: 'client-1',
        clientName: 'CI tester',
        clientKind: 'api_client',
        clientInfo: { name: 'cursor-test', version: '1.2.3' },
        userId: 'user-1',
        userName: 'Ada',
        errorType: 'validation',
        message: zodValidationMessage('list_projects'),
        arguments: { projectId: SECRET },
        token: SECRET,
      },
    });

    expect(view.errorType).toBe('validation');
    expect(view.message).toContain('projectId');
    expect(view.message).not.toContain(SECRET);
    expect(view.client).toEqual({
      id: 'client-1',
      name: 'CI tester',
      kind: 'api_client',
      oauthClientId: null,
    });
    expect(view.clientInfo).toEqual({ name: 'cursor-test', version: '1.2.3' });
    expect(view.user).toEqual({ id: 'user-1', name: 'Ada' });
    expect(view).not.toHaveProperty('arguments');
    expect(JSON.stringify(view)).not.toContain(SECRET);
    expect(JSON.stringify(view)).not.toContain(POSTGRES);
  });

  test('hides a connection string stored on an older llm error row', () => {
    const view = projectRecentAuditError({
      id: 'evt-2',
      action: 'llm.tool_error',
      entityType: 'llm_tool',
      entityId: 'search_knowledge',
      createdAt: '2026-10-22T00:00:00.000Z',
      actorType: 'api_client',
      actorId: 'client-9',
      metadata: { message: `failed: ${POSTGRES}` },
    });
    expect(view.errorType).toBeNull();
    expect(view.message).not.toContain('postgres://');
    expect(view.message).toContain('[redacted]');
    expect(view.client.id).toBe('client-9');
  });
});
