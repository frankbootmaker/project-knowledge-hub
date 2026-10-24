import type { ZodTypeAny } from 'zod';
import type { ToolInputSchema } from './tool-input.js';

type ZodCheck = { kind: string; value?: number; regex?: RegExp };

type ZodDef = {
  typeName: string;
  description?: string;
  innerType?: ZodTypeAny;
  schema?: ZodTypeAny;
  type?: ZodTypeAny;
  shape?: () => Record<string, ZodTypeAny>;
  values?: string[];
  checks?: ZodCheck[];
  minLength?: { value: number } | null;
  maxLength?: { value: number } | null;
};

function defOf(schema: ZodTypeAny): ZodDef {
  return (schema as unknown as { _def: ZodDef })._def;
}

function readDescription(schema: ZodTypeAny): string | undefined {
  const description = defOf(schema).description;
  return typeof description === 'string' && description.length > 0 ? description : undefined;
}

function unwrap(schema: ZodTypeAny): {
  schema: ZodTypeAny;
  optional: boolean;
  nullable: boolean;
  description?: string;
} {
  let current = schema;
  let optional = false;
  let nullable = false;
  let description = readDescription(current);
  for (let guard = 0; guard < 8; guard += 1) {
    const kind = defOf(current).typeName;
    if (kind === 'ZodOptional' || kind === 'ZodDefault') {
      optional = true;
      current = defOf(current).innerType!;
      description = description ?? readDescription(current);
      continue;
    }
    if (kind === 'ZodNullable') {
      nullable = true;
      current = defOf(current).innerType!;
      description = description ?? readDescription(current);
      continue;
    }
    if (kind === 'ZodEffects') {
      current = defOf(current).schema!;
      description = description ?? readDescription(current);
      continue;
    }
    break;
  }
  return { schema: current, optional, nullable, description };
}

function convert(schema: ZodTypeAny): ToolInputSchema {
  const unwrapped = unwrap(schema);
  const kind = defOf(unwrapped.schema).typeName;
  const result: ToolInputSchema = {};
  if (unwrapped.description) result.description = unwrapped.description;
  if (unwrapped.nullable) result.nullable = true;

  if (kind === 'ZodObject') {
    const shape = defOf(unwrapped.schema).shape?.() ?? {};
    const properties: Record<string, ToolInputSchema> = {};
    const required: string[] = [];
    for (const [key, child] of Object.entries(shape)) {
      properties[key] = convert(child);
      if (!unwrap(child).optional) required.push(key);
    }
    result.type = 'object';
    result.properties = properties;
    if (required.length > 0) result.required = required;
    return result;
  }

  if (kind === 'ZodString') {
    result.type = 'string';
    for (const check of defOf(unwrapped.schema).checks ?? []) {
      if (check.kind === 'min' && check.value != null) result.minLength = check.value;
      if (check.kind === 'max' && check.value != null) result.maxLength = check.value;
      if (check.kind === 'uuid') result.format = 'uuid';
      if (check.kind === 'regex' && check.regex) result.pattern = check.regex.source;
    }
    return result;
  }

  if (kind === 'ZodNumber') {
    let integer = false;
    for (const check of defOf(unwrapped.schema).checks ?? []) {
      if (check.kind === 'int') integer = true;
      if (check.kind === 'min' && check.value != null) result.minimum = check.value;
      if (check.kind === 'max' && check.value != null) result.maximum = check.value;
    }
    result.type = integer ? 'integer' : 'number';
    return result;
  }

  if (kind === 'ZodBoolean') {
    result.type = 'boolean';
    return result;
  }

  if (kind === 'ZodArray') {
    result.type = 'array';
    const arrayDef = defOf(unwrapped.schema);
    if (arrayDef.minLength) result.minItems = arrayDef.minLength.value;
    if (arrayDef.maxLength) result.maxItems = arrayDef.maxLength.value;
    if (arrayDef.type) result.items = convert(arrayDef.type);
    return result;
  }

  if (kind === 'ZodEnum') {
    result.type = 'string';
    result.enum = [...(defOf(unwrapped.schema).values ?? [])];
    return result;
  }

  result.type = 'string';
  return result;
}

/** JSON Schema subset used by call_hub_tool, derived from the Zod tool schema. */
export function zodObjectToToolSchema(schema: ZodTypeAny): ToolInputSchema {
  return convert(schema);
}
