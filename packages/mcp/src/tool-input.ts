import { AppError } from '@project-knowledge-hub/domain';

/**
 * JSON Schema subset used by the LLM tool catalog.
 * OpenAPI-style `nullable` is accepted.
 */
export type ToolInputSchema = {
  type?: string;
  format?: string;
  description?: string;
  enum?: unknown[];
  nullable?: boolean;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  pattern?: string;
  required?: string[];
  properties?: Record<string, ToolInputSchema>;
  items?: ToolInputSchema;
  additionalProperties?: boolean | ToolInputSchema;
  oneOf?: ToolInputSchema[];
  anyOf?: ToolInputSchema[];
};

export type ToolInputIssue = {
  field: string;
  code: 'required' | 'invalid';
  message: string;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isSchema(value: unknown): value is ToolInputSchema {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function joinPath(parent: string, key: string): string {
  return parent ? `${parent}.${key}` : key;
}

function fieldLabel(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .toLowerCase();
}

function invalid(field: string, expected: string): ToolInputIssue {
  const name = field || '(root)';
  return {
    field: name,
    code: 'invalid',
    message: `Invalid field ${name}: expected ${expected}`,
  };
}

function expectedPhrase(schema: ToolInputSchema): string {
  if (schema.format === 'uuid') return 'a UUID';
  if (schema.enum && schema.enum.length > 0) {
    return `one of ${schema.enum.map(String).join(', ')}`;
  }
  if (schema.oneOf || schema.anyOf) return 'a value matching the schema';
  switch (schema.type) {
    case 'string':
      return 'a string';
    case 'integer':
      return 'an integer';
    case 'number':
      return 'a number';
    case 'boolean':
      return 'a boolean';
    case 'array':
      return 'an array';
    case 'object':
      return 'an object';
    default:
      return 'a valid value';
  }
}

function checkString(
  schema: ToolInputSchema,
  value: string,
  field: string,
  issues: ToolInputIssue[],
) {
  if (schema.format === 'uuid' && !UUID_PATTERN.test(value)) {
    issues.push(invalid(field, 'a UUID'));
    return;
  }
  if (schema.minLength != null && value.length < schema.minLength) {
    issues.push(invalid(field, `a string of at least ${schema.minLength} characters`));
    return;
  }
  if (schema.maxLength != null && value.length > schema.maxLength) {
    issues.push(invalid(field, `a string of at most ${schema.maxLength} characters`));
    return;
  }
  if (schema.pattern) {
    try {
      if (!new RegExp(schema.pattern).test(value)) {
        issues.push(invalid(field, 'a value matching the required pattern'));
        return;
      }
    } catch {
      // Ignore an unusable pattern rather than failing the call.
    }
  }
  if (schema.enum && !schema.enum.includes(value)) {
    issues.push(invalid(field, expectedPhrase(schema)));
  }
}

function checkNumber(
  schema: ToolInputSchema,
  value: number,
  field: string,
  issues: ToolInputIssue[],
  integer: boolean,
) {
  if (integer && !Number.isInteger(value)) {
    issues.push(invalid(field, 'an integer'));
    return;
  }
  if (schema.minimum != null && value < schema.minimum) {
    issues.push(invalid(field, `a number >= ${schema.minimum}`));
    return;
  }
  if (schema.maximum != null && value > schema.maximum) {
    issues.push(invalid(field, `a number <= ${schema.maximum}`));
    return;
  }
  if (schema.enum && !schema.enum.includes(value)) {
    issues.push(invalid(field, expectedPhrase(schema)));
  }
}

function validateValue(
  schema: ToolInputSchema,
  value: unknown,
  field: string,
  issues: ToolInputIssue[],
): void {
  if (value === undefined) return;
  if (value === null) {
    if (!schema.nullable) issues.push(invalid(field, expectedPhrase(schema)));
    return;
  }

  const alternatives = schema.oneOf ?? schema.anyOf;
  if (alternatives && alternatives.length > 0) {
    const matched = alternatives.some((option) => {
      const nested: ToolInputIssue[] = [];
      validateValue(option, value, field, nested);
      return nested.length === 0;
    });
    if (!matched) issues.push(invalid(field, expectedPhrase(schema)));
    return;
  }

  if (schema.type === 'object' || (!schema.type && schema.properties)) {
    if (!isPlainObject(value)) {
      issues.push(invalid(field, 'an object'));
      return;
    }
    validateObject(schema, value, field, issues);
    return;
  }

  if (schema.type === 'array') {
    if (!Array.isArray(value)) {
      issues.push(invalid(field, 'an array'));
      return;
    }
    if (schema.minItems != null && value.length < schema.minItems) {
      issues.push(invalid(field, `an array of at least ${schema.minItems} items`));
      return;
    }
    if (schema.maxItems != null && value.length > schema.maxItems) {
      issues.push(invalid(field, `an array of at most ${schema.maxItems} items`));
      return;
    }
    if (schema.items) {
      value.forEach((item, index) => {
        validateValue(schema.items as ToolInputSchema, item, `${field}[${index}]`, issues);
      });
    }
    return;
  }

  if (schema.type === 'string') {
    if (typeof value !== 'string') {
      issues.push(invalid(field, expectedPhrase(schema)));
      return;
    }
    checkString(schema, value, field, issues);
    return;
  }

  if (schema.type === 'integer' || schema.type === 'number') {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      issues.push(invalid(field, expectedPhrase(schema)));
      return;
    }
    checkNumber(schema, value, field, issues, schema.type === 'integer');
    return;
  }

  if (schema.type === 'boolean') {
    if (typeof value !== 'boolean') issues.push(invalid(field, 'a boolean'));
    return;
  }

  if (schema.enum && !schema.enum.includes(value)) {
    issues.push(invalid(field, expectedPhrase(schema)));
  }
}

function validateObject(
  schema: ToolInputSchema,
  value: Record<string, unknown>,
  parent: string,
  issues: ToolInputIssue[],
): void {
  const properties = schema.properties ?? {};
  for (const key of schema.required ?? []) {
    const field = joinPath(parent, key);
    if (!Object.prototype.hasOwnProperty.call(value, key) || value[key] === undefined) {
      issues.push({
        field,
        code: 'required',
        message: `Missing required field: ${field}`,
      });
    }
  }
  for (const [key, child] of Object.entries(properties)) {
    if (!Object.prototype.hasOwnProperty.call(value, key) || value[key] === undefined) {
      continue;
    }
    validateValue(child, value[key], joinPath(parent, key), issues);
  }
}

function asToolSchema(schema: unknown): ToolInputSchema | undefined {
  return isSchema(schema) ? schema : undefined;
}

/** Names of missing or invalid arguments. Does not throw. */
export function toolInputIssues(schema: unknown, value: unknown): ToolInputIssue[] {
  const parsed = asToolSchema(schema);
  if (!parsed) return [];
  const issues: ToolInputIssue[] = [];
  if (!isPlainObject(value)) {
    issues.push(invalid('', 'an object'));
    return issues;
  }
  validateObject(parsed, value, '', issues);
  return issues;
}

/** Allowed and required field names for a validation error. */
export function toolSchemaFieldHint(schema: unknown): string {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return '';
  const body = schema as ToolInputSchema;
  const allowed = body.properties ? Object.keys(body.properties) : [];
  const required = Array.isArray(body.required)
    ? body.required.filter((name) => typeof name === 'string')
    : [];
  const parts: string[] = [];
  if (allowed.length > 0) parts.push(`Allowed fields: ${allowed.join(', ')}.`);
  if (required.length > 0) parts.push(`Required fields: ${required.join(', ')}.`);
  return parts.join(' ');
}

export function appendToolSchemaFieldHint(message: string, schema: unknown): string {
  const hint = toolSchemaFieldHint(schema);
  if (!hint || message.includes('Allowed fields:')) return message;
  return `${message} ${hint}`;
}

export function formatToolInputIssues(issues: ToolInputIssue[]): string {
  const missing = issues.filter((issue) => issue.code === 'required').map((issue) => issue.field);
  const invalidIssues = issues.filter((issue) => issue.code === 'invalid');
  const parts: string[] = [];
  if (missing.length === 1) {
    parts.push(`Missing required field: ${missing[0]}`);
  } else if (missing.length > 1) {
    parts.push(`Missing required fields: ${missing.join(', ')}`);
  }
  for (const issue of invalidIssues) {
    parts.push(issue.message);
  }
  return parts.join('; ');
}

/**
 * Reject missing or invalid tool arguments before a handler runs.
 * A missing projectId used to reach the database and come back as
 * "Internal error" instead of a 400 that names the field.
 */
export function assertToolInput(schema: unknown, value: unknown): void {
  const issues = toolInputIssues(schema, value);
  if (issues.length === 0) return;
  throw new AppError({
    code: 'VALIDATION_ERROR',
    message: appendToolSchemaFieldHint(formatToolInputIssues(issues), schema),
    statusCode: 400,
    details: {
      fields: issues.map((issue) => ({ field: issue.field, code: issue.code })),
    },
  });
}

function describeRequiredProperty(key: string, prop: ToolInputSchema): void {
  const current = typeof prop.description === 'string' ? prop.description.trim() : '';
  if (/required/i.test(current)) return;
  if (
    key === 'projectId'
    && prop.format === 'uuid'
    && (current === '' || current === 'Project id')
  ) {
    prop.description = 'Required project id (UUID).';
    return;
  }
  if (!current) {
    prop.description = prop.format === 'uuid'
      ? `Required ${fieldLabel(key)} (UUID).`
      : `Required ${fieldLabel(key)}.`;
    return;
  }
  prop.description = `Required. ${current}`;
}

/** Prefix required property descriptions so tools/list states the field is required. */
export function annotateRequiredFieldDescriptions(schema: unknown): void {
  if (!isSchema(schema)) return;
  if (schema.type === 'array' && schema.items) {
    annotateRequiredFieldDescriptions(schema.items);
    return;
  }
  const required = new Set(schema.required ?? []);
  for (const [key, child] of Object.entries(schema.properties ?? {})) {
    if (!isSchema(child)) continue;
    if (required.has(key)) describeRequiredProperty(key, child);
    annotateRequiredFieldDescriptions(child);
    if (child.items) annotateRequiredFieldDescriptions(child.items);
    for (const option of [...(child.oneOf ?? []), ...(child.anyOf ?? [])]) {
      annotateRequiredFieldDescriptions(option);
    }
  }
  for (const option of [...(schema.oneOf ?? []), ...(schema.anyOf ?? [])]) {
    annotateRequiredFieldDescriptions(option);
  }
}
