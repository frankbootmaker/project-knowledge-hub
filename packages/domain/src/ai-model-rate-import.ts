import {
  AI_MODEL_PRICE_UNIT,
  validateAiModelPriceWrite,
  type AiModelPrice,
  type AiModelPriceWrite,
  type PriceFieldError,
} from './ai-model-price.js';

export const MODEL_RATE_IMPORT_MAX_CHARS = 500_000;
export const MODEL_RATE_IMPORT_MAX_ROWS = 200;

export const MODEL_RATE_CSV_HEADERS = [
  'pattern',
  'input_per_million',
  'output_per_million',
  'cache_read_per_million',
  'cache_write_per_million',
  'blended_per_million',
  'currency',
  'effective_from',
  'source_note',
  'unit',
] as const;

const HEADER_ALIASES: Record<string, string> = {
  pattern: 'model',
  model: 'model',
  input_per_million: 'inputPerMillion',
  inputpermillion: 'inputPerMillion',
  output_per_million: 'outputPerMillion',
  outputpermillion: 'outputPerMillion',
  cache_read_per_million: 'cacheReadPerMillion',
  cachereadpermillion: 'cacheReadPerMillion',
  cache_write_per_million: 'cacheWritePerMillion',
  cachewritepermillion: 'cacheWritePerMillion',
  blended_per_million: 'blendedPerMillion',
  blendedpermillion: 'blendedPerMillion',
  blended: 'blendedPerMillion',
  currency: 'currency',
  effective_from: 'effectiveFrom',
  effectivefrom: 'effectiveFrom',
  source_note: 'sourceNote',
  sourcenote: 'sourceNote',
  source: 'sourceNote',
  note: 'sourceNote',
  unit: 'unit',
};

const ACCEPTED_UNITS = new Set(['per_1m_tokens', 'per_1m', 'per_million']);

export type ModelRateImportError = PriceFieldError & { row: number };

export type ModelRateChange = {
  before: Pick<
    AiModelPrice,
    | 'model'
    | 'inputPerMillion'
    | 'outputPerMillion'
    | 'cacheReadPerMillion'
    | 'cacheWritePerMillion'
    | 'blendedPerMillion'
    | 'currency'
    | 'effectiveFrom'
    | 'sourceNote'
  >;
  after: AiModelPriceWrite;
};

export type ModelRateImportPlan = {
  added: AiModelPriceWrite[];
  changed: ModelRateChange[];
  unchanged: AiModelPriceWrite[];
  errors: ModelRateImportError[];
  /** Rows to write. Empty when any row failed validation. */
  writable: AiModelPriceWrite[];
};

function headerKey(cell: string): string {
  return cell.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

/** RFC-style CSV. Quoted fields may contain commas and new lines. */
export function parseCsvTable(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^\uFEFF/, '');
  for (let index = 0; index < src.length; index += 1) {
    const char = src[index] ?? '';
    if (quoted) {
      if (char === '"') {
        if (src[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === ',') {
      row.push(cell);
      cell = '';
      continue;
    }
    if (char === '\n' || char === '\r') {
      if (char === '\r' && src[index + 1] === '\n') index += 1;
      row.push(cell);
      cell = '';
      if (row.some((value) => value.trim() !== '')) rows.push(row);
      row = [];
      continue;
    }
    cell += char;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    if (row.some((value) => value.trim() !== '')) rows.push(row);
  }
  return rows;
}

function numberOrUndefined(value: unknown): number | undefined {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return Number.NaN;
  return Number(trimmed);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function unitError(unit: unknown): string | null {
  if (typeof unit !== 'string' || unit.trim() === '') {
    return 'unit is required and must be per_1m_tokens (per 1,000,000 tokens)';
  }
  const normalized = unit.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (normalized === 'per_1k' || normalized === 'per_1k_tokens' || normalized === '1k') {
    return 'unit per_1k is not accepted; prices are per 1,000,000 tokens (per_1m_tokens)';
  }
  if (!ACCEPTED_UNITS.has(normalized)) {
    return 'unit must be per_1m_tokens';
  }
  return null;
}

function rowFromRecord(
  record: Record<string, unknown>,
  fileUnit: unknown,
): { raw: Partial<AiModelPriceWrite>; unit: unknown } {
  const read = (snake: string, camel: string): unknown =>
    record[snake] ?? record[camel] ?? record[headerKey(snake)];
  return {
    unit: record.unit ?? fileUnit,
    raw: {
      model: String(read('pattern', 'model') ?? read('model', 'pattern') ?? ''),
      inputPerMillion: numberOrUndefined(read('input_per_million', 'inputPerMillion')),
      outputPerMillion: numberOrUndefined(read('output_per_million', 'outputPerMillion')),
      cacheReadPerMillion: numberOrUndefined(
        read('cache_read_per_million', 'cacheReadPerMillion'),
      ),
      cacheWritePerMillion: numberOrUndefined(
        read('cache_write_per_million', 'cacheWritePerMillion'),
      ),
      blendedPerMillion: numberOrUndefined(read('blended_per_million', 'blendedPerMillion')),
      currency: typeof record.currency === 'string' ? record.currency : '',
      effectiveFrom: String(read('effective_from', 'effectiveFrom') ?? ''),
      sourceNote:
        read('source_note', 'sourceNote') == null
          ? null
          : String(read('source_note', 'sourceNote')),
    },
  };
}

function parseCsvRows(text: string): {
  rows: Array<{ raw: Partial<AiModelPriceWrite>; unit: unknown }>;
  errors: ModelRateImportError[];
} {
  const table = parseCsvTable(text);
  if (table.length === 0) {
    return { rows: [], errors: [{ row: 0, field: 'file', message: 'File is empty' }] };
  }
  const header = table[0] ?? [];
  const columns = header.map((cell) => HEADER_ALIASES[headerKey(cell)] ?? '');
  if (!columns.includes('model') || !columns.includes('unit')) {
    return {
      rows: [],
      errors: [
        {
          row: 1,
          field: 'header',
          message: `Header must include pattern and unit. Expected ${MODEL_RATE_CSV_HEADERS.join(',')}`,
        },
      ],
    };
  }
  const rows = table.slice(1).map((cells) => {
    const record: Record<string, unknown> = {};
    columns.forEach((name, index) => {
      if (name) record[name] = cells[index] ?? '';
    });
    return rowFromRecord(record, record.unit);
  });
  return { rows, errors: [] };
}

function parseJsonRows(text: string): {
  rows: Array<{ raw: Partial<AiModelPriceWrite>; unit: unknown }>;
  errors: ModelRateImportError[];
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { rows: [], errors: [{ row: 0, field: 'file', message: 'JSON is not valid' }] };
  }
  const envelope = asRecord(parsed);
  const fileUnit = envelope?.unit;
  const list = Array.isArray(parsed) ? parsed : envelope?.rows;
  if (!Array.isArray(list)) {
    return {
      rows: [],
      errors: [
        {
          row: 0,
          field: 'file',
          message: 'JSON must be { "unit": "per_1m_tokens", "rows": [...] } or an array of rows',
        },
      ],
    };
  }
  return {
    rows: list.map((item) => {
      const record = asRecord(item);
      if (!record) return { raw: {}, unit: fileUnit };
      return rowFromRecord(record, fileUnit);
    }),
    errors: [],
  };
}

function sameRate(left: number, right: number): boolean {
  return Math.round(left * 1_000_000) === Math.round(right * 1_000_000);
}

function samePrice(existing: AiModelPrice, next: AiModelPriceWrite): boolean {
  return (
    sameRate(existing.inputPerMillion, next.inputPerMillion) &&
    sameRate(existing.outputPerMillion, next.outputPerMillion) &&
    sameRate(existing.cacheReadPerMillion, next.cacheReadPerMillion) &&
    sameRate(existing.cacheWritePerMillion, next.cacheWritePerMillion) &&
    sameRate(existing.blendedPerMillion, next.blendedPerMillion) &&
    existing.currency.toUpperCase() === next.currency &&
    (existing.sourceNote ?? '') === (next.sourceNote ?? '')
  );
}

/**
 * Preview a CSV or JSON rate file against the rows already stored for one
 * scope. Validation errors leave `writable` empty so nothing is applied.
 */
export function planModelRateImport(
  existing: readonly AiModelPrice[],
  text: string,
  format: 'csv' | 'json',
): ModelRateImportPlan {
  if (text.length > MODEL_RATE_IMPORT_MAX_CHARS) {
    return {
      added: [],
      changed: [],
      unchanged: [],
      writable: [],
      errors: [{ row: 0, field: 'file', message: 'File is too large' }],
    };
  }
  const parsed = format === 'csv' ? parseCsvRows(text) : parseJsonRows(text);
  const errors = [...parsed.errors];
  const accepted: AiModelPriceWrite[] = [];
  if (parsed.rows.length > MODEL_RATE_IMPORT_MAX_ROWS) {
    errors.push({
      row: 0,
      field: 'file',
      message: `At most ${MODEL_RATE_IMPORT_MAX_ROWS} rows`,
    });
  }
  parsed.rows.forEach((row, index) => {
    const rowNumber = index + 1;
    const unitProblem = unitError(row.unit);
    if (unitProblem) errors.push({ row: rowNumber, field: 'unit', message: unitProblem });
    const validated = validateAiModelPriceWrite(row.raw, { requireSourceNote: true });
    if (!validated.ok) {
      for (const error of validated.errors) {
        errors.push({ row: rowNumber, ...error });
      }
      return;
    }
    accepted.push(validated.price);
  });
  if (errors.length > 0) {
    return { added: [], changed: [], unchanged: [], errors, writable: [] };
  }
  const active = existing.filter((row) => !row.retiredAt);
  const added: AiModelPriceWrite[] = [];
  const changed: ModelRateChange[] = [];
  const unchanged: AiModelPriceWrite[] = [];
  for (const row of accepted) {
    const before = active.find(
      (item) =>
        item.model.trim().toLowerCase() === row.model.trim().toLowerCase() &&
        item.effectiveFrom === row.effectiveFrom,
    );
    if (!before) {
      added.push(row);
      continue;
    }
    if (samePrice(before, row)) unchanged.push(row);
    else {
      changed.push({
        before: {
          model: before.model,
          inputPerMillion: before.inputPerMillion,
          outputPerMillion: before.outputPerMillion,
          cacheReadPerMillion: before.cacheReadPerMillion,
          cacheWritePerMillion: before.cacheWritePerMillion,
          blendedPerMillion: before.blendedPerMillion,
          currency: before.currency,
          effectiveFrom: before.effectiveFrom,
          sourceNote: before.sourceNote ?? null,
        },
        after: row,
      });
    }
  }
  return {
    added,
    changed,
    unchanged,
    errors,
    writable: [...added, ...changed.map((row) => row.after)],
  };
}

function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

export function modelRatesToCsv(rows: readonly AiModelPrice[]): string {
  const lines = [MODEL_RATE_CSV_HEADERS.join(',')];
  for (const row of rows) {
    if (row.retiredAt) continue;
    lines.push(
      [
        row.model,
        String(row.inputPerMillion),
        String(row.outputPerMillion),
        String(row.cacheReadPerMillion),
        String(row.cacheWritePerMillion),
        String(row.blendedPerMillion),
        row.currency,
        row.effectiveFrom,
        row.sourceNote ?? '',
        AI_MODEL_PRICE_UNIT,
      ]
        .map(csvCell)
        .join(','),
    );
  }
  return `${lines.join('\n')}\n`;
}

export function modelRatesToJson(rows: readonly AiModelPrice[]): string {
  return JSON.stringify(
    {
      unit: AI_MODEL_PRICE_UNIT,
      rows: rows
        .filter((row) => !row.retiredAt)
        .map((row) => ({
          pattern: row.model,
          inputPerMillion: row.inputPerMillion,
          outputPerMillion: row.outputPerMillion,
          cacheReadPerMillion: row.cacheReadPerMillion,
          cacheWritePerMillion: row.cacheWritePerMillion,
          blendedPerMillion: row.blendedPerMillion,
          currency: row.currency,
          effectiveFrom: row.effectiveFrom,
          sourceNote: row.sourceNote ?? '',
          unit: AI_MODEL_PRICE_UNIT,
        })),
    },
    null,
    2,
  );
}
