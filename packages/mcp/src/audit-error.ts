/**
 * Safe audit fields for MCP tool failures.
 * Field paths and Zod codes may be stored. Argument values, tokens, and
 * secrets must not be.
 */

export const MCP_AUDIT_ERROR_MESSAGE_MAX = 300;

export const MCP_AUDIT_ERROR_TYPES = [
  'validation',
  'not_found',
  'forbidden',
  'conflict',
  'internal',
] as const;

export type McpAuditErrorType = (typeof MCP_AUDIT_ERROR_TYPES)[number];

export type McpAuditClientInfo = {
  name: string;
  version: string;
};

export type McpToolErrorDetail = {
  errorType: McpAuditErrorType;
  message: string;
};

export type McpAuditToolContext = {
  recordId?: string;
  projectId?: string;
  systemId?: string;
  workspaceId?: string;
  mediaId?: string;
  error?: McpToolErrorDetail;
  clientInfo?: McpAuditClientInfo | null;
  nestedTool?: string;
};

export type McpAuditClient = {
  id: string;
  name: string;
  actingUserId?: string | null;
  oauthGrantId?: string | null;
  oauthClientId?: string | null;
};

type AppErrorLike = {
  name?: string;
  code?: unknown;
  statusCode?: unknown;
  message?: unknown;
};

type ZodLikeIssue = {
  code?: unknown;
  path?: unknown;
  keys?: unknown;
  expected?: unknown;
};

const SECRET_PATTERNS: RegExp[] = [
  /bearer\s+[a-z0-9\-._~+/]+=*/gi,
  /\bkh_[a-z0-9_]+\b/gi,
  /\bsk-[a-z0-9]+\b/gi,
  /postgres(?:ql)?:\/\/\S+/gi,
  /mongodb(?:\+srv)?:\/\/\S+/gi,
  /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  /(?:api[_-]?key|token|secret|password|authorization)\s*[:=]\s*['"]?[^\s'",}]+/gi,
];

function isAppErrorLike(error: unknown): error is AppErrorLike {
  if (!error || typeof error !== 'object') return false;
  const row = error as AppErrorLike;
  return row.name === 'AppError' || (
    typeof row.statusCode === 'number' && typeof row.code === 'string'
  );
}

function isInvalidParams(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  return code === -32602 || code === 'InvalidParams';
}

function isCallerConflict(status: number, code: string): boolean {
  if (status === 409) return true;
  return /CONFLICT|DUPLICATE|CONTENT_CHANGED|TAKEN|AMBIGUOUS|STILL_REFERENCED/i.test(code);
}

/** Map a thrown tool error onto the audit buckets. `internal` is only 5xx or unhandled. */
export function classifyMcpToolError(error: unknown): McpAuditErrorType {
  if (isInvalidParams(error)) return 'validation';
  if (isAppErrorLike(error)) {
    const status = typeof error.statusCode === 'number' ? error.statusCode : 500;
    const code = typeof error.code === 'string' ? error.code : '';
    if (status === 404 || /NOT_FOUND$/i.test(code)) return 'not_found';
    if (
      status === 401
      || status === 403
      || /FORBIDDEN|UNAUTHENTICATED|UNAUTHORIZED/i.test(code)
    ) {
      return 'forbidden';
    }
    if (isCallerConflict(status, code)) return 'conflict';
    if (
      status === 400
      || status === 422
      || code === 'VALIDATION_ERROR'
      || /VALIDAT/i.test(code)
      || (status >= 400 && status < 500)
    ) {
      return 'validation';
    }
    return 'internal';
  }
  if (error instanceof Error) return classifyMcpToolErrorMessage(error.message);
  return 'internal';
}

/** Classify when the original error object is no longer available. */
export function classifyMcpToolErrorMessage(message: string): McpAuditErrorType {
  if (
    /input validation error|output validation error|invalid arguments for tool|invalid tools\/call|invalid params|-32602/i
      .test(message)
  ) {
    return 'validation';
  }
  if (/missing required scope|forbidden|insufficient_scope|unauthenticated/i.test(message)) {
    return 'forbidden';
  }
  if (/\bnot found\b/i.test(message)) return 'not_found';
  if (
    /content changed|already uses this cloud agent|duplicate entry|uniqueness|precondition|conflict/i
      .test(message)
  ) {
    return 'conflict';
  }
  return 'internal';
}

function issuePath(issue: ZodLikeIssue): string {
  if (!Array.isArray(issue.path) || issue.path.length === 0) return '(root)';
  const parts = issue.path.filter(
    (part) => typeof part === 'string' || typeof part === 'number',
  );
  return parts.length ? parts.map(String).join('.') : '(root)';
}

function summarizeIssues(issues: ZodLikeIssue[]): string | null {
  const parts: string[] = [];
  for (const issue of issues.slice(0, 8)) {
    if (typeof issue.code !== 'string' || !/^[a-z0-9_]+$/i.test(issue.code)) continue;
    let piece = `${issuePath(issue)}: ${issue.code}`;
    if (
      typeof issue.expected === 'string'
      && issue.expected.length > 0
      && issue.expected.length <= 40
      && /^[a-z0-9_| ]+$/i.test(issue.expected)
    ) {
      piece += ` expected ${issue.expected}`;
    }
    if (issue.code === 'unrecognized_keys' && Array.isArray(issue.keys)) {
      const keys = issue.keys
        .filter((key): key is string => (
          typeof key === 'string'
          && /^[A-Za-z0-9_.-]{1,40}$/.test(key)
          && !/kh_|bearer|postgres|eyJ|^sk-/i.test(key)
        ))
        .slice(0, 6);
      if (keys.length > 0) piece += ` (${keys.join(', ')})`;
    }
    parts.push(piece);
  }
  return parts.length > 0 ? parts.join('; ') : null;
}

function extractIssues(message: string): ZodLikeIssue[] | null {
  const start = message.indexOf('[');
  if (start < 0) return null;
  try {
    const parsed = JSON.parse(message.slice(start)) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    const issues = parsed.filter(
      (item): item is ZodLikeIssue => Boolean(item) && typeof item === 'object',
    );
    if (!issues.some((issue) => typeof issue.code === 'string')) return null;
    return issues;
  } catch {
    return null;
  }
}

function validationHeading(message: string): string {
  const tool = message.match(/tool ([A-Za-z0-9_]+)/);
  const kind = /output validation error/i.test(message)
    ? 'Output validation error'
    : 'Input validation error';
  return tool ? `${kind} for ${tool[1]}` : kind;
}

/**
 * Turn a Zod / SDK validation payload into path + code text.
 * Returns null when the message is not a validation payload.
 */
export function summarizeValidationMessage(message: string): string | null {
  const looksLikeValidation = /validation error|invalid arguments for tool|invalid tools\/call/i
    .test(message);
  const issues = extractIssues(message);
  if (!issues) {
    if (looksLikeValidation && /received|\{|\[/.test(message)) {
      return validationHeading(message);
    }
    return null;
  }
  const summary = summarizeIssues(issues);
  if (!summary) {
    return looksLikeValidation ? validationHeading(message) : null;
  }
  if (!looksLikeValidation && !message.trimStart().startsWith('[')) return null;
  return looksLikeValidation ? `${validationHeading(message)}: ${summary}` : summary;
}

function redactSecrets(text: string): string {
  let next = text;
  for (const pattern of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    next = next.replace(pattern, '[redacted]');
  }
  next = next.replace(/\breceived\s+(?:'[^']*'|"[^"]*")/gi, 'received [redacted]');
  next = next.replace(
    /"received"\s*:\s*(?:"[^"]*"|-?\d+(?:\.\d+)?|true|false|null)/g,
    '"received":"[redacted]"',
  );
  return next;
}

function stripQuotedValues(text: string): string {
  return text.replace(/"[^"]*"|'[^']*'/g, '"[redacted]"');
}

/** Shorten and strip secrets. Validation text keeps paths and codes only. */
export function sanitizeAuditErrorMessage(
  message: string,
  errorType?: McpAuditErrorType,
): string {
  const summarized = summarizeValidationMessage(message);
  let text = summarized ?? message;
  const validation = errorType === 'validation' || summarized != null;
  if (validation && !summarized && /received|\{|\[/.test(text)) {
    text = validationHeading(text);
  }
  text = redactSecrets(text);
  if (validation) text = stripQuotedValues(text);
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (!collapsed) return 'MCP tool error';
  if (collapsed.length <= MCP_AUDIT_ERROR_MESSAGE_MAX) return collapsed;
  return collapsed.slice(0, MCP_AUDIT_ERROR_MESSAGE_MAX);
}

/** MCP initialize clientInfo, or null when missing or unsafe. */
export function sanitizeClientInfo(
  info: { name?: unknown; version?: unknown } | null | undefined,
): McpAuditClientInfo | null {
  if (!info || typeof info.name !== 'string') return null;
  const name = info.name.trim().slice(0, 80);
  const version = typeof info.version === 'string' ? info.version.trim().slice(0, 40) : '';
  if (!name) return null;
  if (/bearer|kh_|postgres|eyJ|secret|token|password/i.test(`${name} ${version}`)) return null;
  return { name, version };
}

const ID_KEYS = ['recordId', 'projectId', 'systemId', 'workspaceId', 'mediaId'] as const;

function pickIds(context: McpAuditToolContext | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!context) return out;
  for (const key of ID_KEYS) {
    const value = context[key];
    if (typeof value === 'string' && value.length > 0 && value.length <= 80) {
      out[key] = value;
    }
  }
  return out;
}

function nestedToolName(value: string | undefined): string | undefined {
  if (!value || !/^[a-z0-9_]{1,80}$/.test(value)) return undefined;
  return value;
}

/**
 * Metadata stored on mcp.tool_call / mcp.tool_error.
 * Copies only known fields. Never copies argument objects.
 */
export function buildMcpToolAuditMetadata(input: {
  client: McpAuditClient;
  toolName: string;
  ok: boolean;
  context?: McpAuditToolContext;
  userName?: string | null;
}): Record<string, unknown> {
  const ids = pickIds(input.context);
  if (input.ok) {
    return {
      clientName: input.client.name,
      toolName: input.toolName,
      ok: true,
      ...ids,
    };
  }
  const errorType = input.context?.error?.errorType ?? 'internal';
  const message = sanitizeAuditErrorMessage(
    input.context?.error?.message ?? 'MCP tool error',
    errorType,
  );
  const clientInfo = sanitizeClientInfo(input.context?.clientInfo);
  const nested = nestedToolName(input.context?.nestedTool);
  const oauth = Boolean(input.client.oauthGrantId);
  const oauthClientId = input.client.oauthClientId?.trim() || null;
  return {
    clientId: input.client.id,
    clientName: oauth && oauthClientId ? oauthClientId : input.client.name,
    clientKind: oauth ? 'oauth' : 'api_client',
    ...(oauthClientId ? { oauthClientId } : {}),
    ...(clientInfo ? { clientInfo } : {}),
    ...(input.client.actingUserId ? { userId: input.client.actingUserId } : {}),
    ...(input.userName ? { userName: input.userName } : {}),
    toolName: input.toolName,
    ok: false,
    errorType,
    message,
    ...(nested ? { nestedTool: nested } : {}),
    ...ids,
  };
}

export type RecentMcpAuditError = {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  createdAt: string;
  errorType: McpAuditErrorType | null;
  message: string | null;
  client: {
    id: string | null;
    name: string | null;
    kind: 'api_client' | 'oauth' | null;
    oauthClientId: string | null;
  };
  clientInfo: McpAuditClientInfo | null;
  user: {
    id: string | null;
    name: string | null;
  } | null;
};

function asString(value: unknown, max = 300): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

function asErrorType(value: unknown): McpAuditErrorType | null {
  if (typeof value !== 'string') return null;
  return MCP_AUDIT_ERROR_TYPES.includes(value as McpAuditErrorType)
    ? (value as McpAuditErrorType)
    : null;
}

/**
 * Public recentAuditErrors row. Reads only the safe metadata keys and
 * sanitizes the message again so older rows cannot leak values.
 */
export function projectRecentAuditError(row: {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  createdAt: string;
  actorType?: string | null;
  actorId?: string | null;
  metadata?: Record<string, unknown> | null;
}): RecentMcpAuditError {
  const meta = row.metadata ?? {};
  const errorType = asErrorType(meta.errorType);
  const rawMessage = asString(meta.message, 2_000);
  const message = rawMessage
    ? sanitizeAuditErrorMessage(rawMessage, errorType ?? classifyMcpToolErrorMessage(rawMessage))
    : null;
  const kind = meta.clientKind === 'oauth' || row.actorType === 'oauth_grant'
    ? 'oauth'
    : meta.clientKind === 'api_client' || row.actorType === 'api_client'
      ? 'api_client'
      : null;
  const clientInfo = sanitizeClientInfo(
    meta.clientInfo && typeof meta.clientInfo === 'object'
      ? (meta.clientInfo as { name?: unknown; version?: unknown })
      : null,
  );
  const userId = asString(meta.userId, 80);
  const userName = asString(meta.userName, 120);
  const clientId = asString(meta.clientId, 80) ?? asString(row.actorId, 80);
  const clientName = asString(meta.clientName, 200);
  return {
    id: row.id,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    createdAt: row.createdAt,
    errorType,
    message,
    client: {
      id: clientId,
      name: clientName,
      kind,
      oauthClientId: asString(meta.oauthClientId, 200),
    },
    clientInfo,
    user: userId || userName ? { id: userId, name: userName } : null,
  };
}
