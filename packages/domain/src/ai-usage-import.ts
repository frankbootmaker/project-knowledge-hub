import { AppError } from './index.js';
import { MAX_TOKEN_COUNT } from './ai-cost.js';

/**
 * Import sources. `csv` is the Cursor usage export. `cursor_admin_api` is
 * reserved so a later importer can reuse normalize, dedupe, and link.
 */
export const AI_USAGE_IMPORT_SOURCES = ['csv', 'cursor_admin_api'] as const;

export type AiUsageImportSource = (typeof AI_USAGE_IMPORT_SOURCES)[number];

export const CURSOR_USAGE_CSV_HEADERS = [
  'Date',
  'Cloud Agent ID',
  'Automation ID',
  'Kind',
  'Model',
  'Max Mode',
  'Input (w/ Cache Write)',
  'Input (w/o Cache Write)',
  'Cache Read',
  'Output Tokens',
  'Total Tokens',
  'Cost',
] as const;

export const CLOUD_AGENT_ID_MAX = 80;
export const USAGE_CSV_MAX_CHARS = 8_000_000;
export const USAGE_CSV_MAX_ROWS = 100_000;
export const USAGE_IMPORT_ERROR_LIMIT = 100;

const MODEL_MAX = 80;
const KIND_MAX = 40;
const COST_MAX = 40;
const AUTOMATION_MAX = 80;

export type AiUsageRowError = {
  rowNumber: number;
  message: string;
};

/** One normalized usage event, independent of the source that produced it. */
export type NormalizedAiUsageRow = {
  rowNumber: number;
  occurredAt: Date;
  /** Exact date text used in the dedupe hash. */
  occurredAtKey: string;
  cloudAgentId: string | null;
  automationId: string | null;
  kind: string | null;
  model: string;
  maxMode: boolean | null;
  tokensInput: number;
  tokensCacheWrite: number;
  tokensCache: number;
  tokensOutput: number;
  tokensTotal: number;
  cost: string | null;
  rowHash: string;
};

export type UsageTokenTotals = {
  tokensInput: number;
  tokensCacheWrite: number;
  tokensCache: number;
  tokensOutput: number;
  tokensTotal: number;
};

export type UsageModelTotal = {
  model: string;
  rowCount: number;
  tokensTotal: number;
};

/** Snapshot stored on the import so the log keeps the preview after confirm. */
export type AiUsageImportSummary = {
  dateFrom: string | null;
  dateTo: string | null;
  totals: UsageTokenTotals;
  models: UsageModelTotal[];
  linkedCount: number;
  unassignedCount: number;
};

export type UsageImportStats = {
  rowCountTotal: number;
  rowCountInserted: number;
  rowCountDuplicate: number;
  rowCountLinked: number;
  rowCountErrors: number;
  /** Rows whose token columns are all empty. Not inserted and not an error. */
  rowCountNoTokens: number;
  dateFrom: string | null;
  dateTo: string | null;
  models: UsageModelTotal[];
  totals: UsageTokenTotals;
  errors: AiUsageRowError[];
};

export type TaskUsageAggregate = {
  tokensInput: number;
  tokensOutput: number;
  tokensCache: number;
  tokensCacheWrite: number;
  /** Sum of the four buckets. This is what the task stores as tokensUsed. */
  tokensUsed: number;
  modelId: string;
  pricingTier: 'max' | 'standard' | null;
  usageOccurredAt: Date;
  billingPeriod: string;
};

type CsvRecord = { line: number; cells: string[] };

/**
 * Cursor's two input columns are disjoint buckets. On the Oct 2026 export,
 * Total Tokens equals Input (w/ Cache Write) + Input (w/o Cache Write)
 * + Cache Read + Output Tokens. "Input (w/ Cache Write)" is the cache-write
 * bucket, not a superset of the other input column. Subtracting the
 * without-cache column drops those tokens from the billable sum and is
 * negative when the cache-write column is 0.
 */
export function mapCursorUsageTokens(input: {
  inputWithCacheWrite: number;
  inputWithoutCacheWrite: number;
  cacheRead: number;
  outputTokens: number;
  totalTokens: number;
}): {
  tokensInput: number;
  tokensCacheWrite: number;
  tokensCache: number;
  tokensOutput: number;
  tokensTotal: number;
} {
  return {
    tokensInput: input.inputWithoutCacheWrite,
    tokensCacheWrite: input.inputWithCacheWrite,
    tokensCache: input.cacheRead,
    tokensOutput: input.outputTokens,
    tokensTotal: input.totalTokens,
  };
}

/** Dedupe key: Date + Cloud Agent ID + Model + Total Tokens. */
export function usageRowHash(parts: {
  occurredAtKey: string;
  cloudAgentId: string;
  model: string;
  tokensTotal: number;
}): string {
  const payload = [
    parts.occurredAtKey,
    parts.cloudAgentId,
    parts.model,
    String(parts.tokensTotal),
  ].join('\u001f');
  return sha256Hex(payload);
}

/**
 * SHA-256 without node:crypto. The domain barrel is imported by the web
 * client, and webpack cannot bundle the node: scheme.
 */
function sha256Hex(message: string): string {
  const bytes = new TextEncoder().encode(message);
  const padded = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 4, bytes.length * 8, false);

  const k = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
    0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;
  const w = new Uint32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      w[index] = view.getUint32(offset + index * 4, false);
    }
    for (let index = 16; index < 64; index += 1) {
      const s0 =
        rotr(w[index - 15]!, 7) ^
        rotr(w[index - 15]!, 18) ^
        (w[index - 15]! >>> 3);
      const s1 =
        rotr(w[index - 2]!, 17) ^
        rotr(w[index - 2]!, 19) ^
        (w[index - 2]! >>> 10);
      w[index] = (w[index - 16]! + s0 + w[index - 7]! + s1) >>> 0;
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;
    for (let index = 0; index < 64; index += 1) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + k[index]! + w[index]!) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((word) => word.toString(16).padStart(8, '0'))
    .join('');
}

function rotr(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

export function parseCloudAgentId(
  value: string | null | undefined,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (trimmed.length > CLOUD_AGENT_ID_MAX || /\s/.test(trimmed)) {
    throw new AppError({
      code: 'CLOUD_AGENT_ID_INVALID',
      message: `Cloud agent id must be 1–${CLOUD_AGENT_ID_MAX} characters without spaces`,
      statusCode: 400,
    });
  }
  return trimmed;
}

export function parseCursorUsageCsv(csv: string): {
  rows: NormalizedAiUsageRow[];
  errors: AiUsageRowError[];
  rowCountNoTokens: number;
} {
  if (csv.length > USAGE_CSV_MAX_CHARS) {
    throw new AppError({
      code: 'CSV_TOO_LARGE',
      message: 'CSV is larger than 8 MB',
      statusCode: 400,
    });
  }
  const records = parseCsvRecords(csv);
  if (records.length === 0) {
    throw new AppError({
      code: 'CSV_HEADER_INVALID',
      message: 'CSV is empty',
      statusCode: 400,
    });
  }
  const header = records[0]?.cells.map((cell) => cell.trim()) ?? [];
  if (!sameHeader(header)) {
    throw new AppError({
      code: 'CSV_HEADER_INVALID',
      message: `CSV header must be: ${CURSOR_USAGE_CSV_HEADERS.join(', ')}`,
      statusCode: 400,
    });
  }
  const data = records.slice(1);
  if (data.length > USAGE_CSV_MAX_ROWS) {
    throw new AppError({
      code: 'CSV_TOO_LARGE',
      message: `CSV has more than ${USAGE_CSV_MAX_ROWS} rows`,
      statusCode: 400,
    });
  }

  const rows: NormalizedAiUsageRow[] = [];
  const errors: AiUsageRowError[] = [];
  let rowCountNoTokens = 0;
  for (const record of data) {
    if (record.cells.every((cell) => cell.trim() === '')) continue;
    const parsed = parseCursorUsageRecord(record);
    if ('skipped' in parsed) {
      rowCountNoTokens += 1;
    } else if ('message' in parsed) {
      errors.push({ rowNumber: record.line, message: parsed.message });
    } else {
      rows.push(parsed);
    }
  }
  return { rows, errors, rowCountNoTokens };
}

/**
 * Source plug-in. CSV is implemented. The Admin API source fails closed
 * until a later change supplies its own parser and calls the shared steps.
 */
export function parseUsageSource(
  source: AiUsageImportSource,
  content: string,
): {
  rows: NormalizedAiUsageRow[];
  errors: AiUsageRowError[];
  rowCountNoTokens: number;
} {
  if (source === 'cursor_admin_api') {
    throw new AppError({
      code: 'USAGE_SOURCE_UNAVAILABLE',
      message: 'Cursor Admin API import is not available yet',
      statusCode: 400,
    });
  }
  return parseCursorUsageCsv(content);
}

export function dedupeUsageRows(
  rows: readonly NormalizedAiUsageRow[],
  existingHashes: ReadonlySet<string>,
): { fresh: NormalizedAiUsageRow[]; duplicateCount: number } {
  const seen = new Set(existingHashes);
  const fresh: NormalizedAiUsageRow[] = [];
  let duplicateCount = 0;
  for (const row of rows) {
    if (seen.has(row.rowHash)) {
      duplicateCount += 1;
      continue;
    }
    seen.add(row.rowHash);
    fresh.push(row);
  }
  return { fresh, duplicateCount };
}

export function linkUsageRows<T extends { cloudAgentId: string | null }>(
  rows: readonly T[],
  taskIdByCloudAgentId: ReadonlyMap<string, string>,
): Array<T & { projectTaskId: string | null }> {
  return rows.map((row) => ({
    ...row,
    projectTaskId: row.cloudAgentId
      ? (taskIdByCloudAgentId.get(row.cloudAgentId) ?? null)
      : null,
  }));
}

export function summarizeUsageRows(
  rows: readonly NormalizedAiUsageRow[],
): {
  dateFrom: string | null;
  dateTo: string | null;
  models: UsageModelTotal[];
  totals: UsageTokenTotals;
} {
  const totals: UsageTokenTotals = {
    tokensInput: 0,
    tokensCacheWrite: 0,
    tokensCache: 0,
    tokensOutput: 0,
    tokensTotal: 0,
  };
  const byModel = new Map<string, UsageModelTotal>();
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const row of rows) {
    totals.tokensInput += row.tokensInput;
    totals.tokensCacheWrite += row.tokensCacheWrite;
    totals.tokensCache += row.tokensCache;
    totals.tokensOutput += row.tokensOutput;
    totals.tokensTotal += row.tokensTotal;
    const current = byModel.get(row.model) ?? {
      model: row.model,
      rowCount: 0,
      tokensTotal: 0,
    };
    current.rowCount += 1;
    current.tokensTotal += row.tokensTotal;
    byModel.set(row.model, current);
    const time = row.occurredAt.getTime();
    if (time < min) min = time;
    if (time > max) max = time;
  }
  const models = [...byModel.values()].sort(
    (left, right) => right.tokensTotal - left.tokensTotal || left.model.localeCompare(right.model),
  );
  return {
    dateFrom: Number.isFinite(min) ? new Date(min).toISOString() : null,
    dateTo: Number.isFinite(max) ? new Date(max).toISOString() : null,
    models,
    totals,
  };
}

/** Shared preview: parse result + hashes already stored + tasks in the workspace. */
export function previewUsageImport(input: {
  rows: readonly NormalizedAiUsageRow[];
  errors: readonly AiUsageRowError[];
  rowCountNoTokens: number;
  existingHashes: ReadonlySet<string>;
  taskIdByCloudAgentId: ReadonlyMap<string, string>;
}): UsageImportStats {
  const deduped = dedupeUsageRows(input.rows, input.existingHashes);
  const linkedFresh = linkUsageRows(deduped.fresh, input.taskIdByCloudAgentId);
  const summary = summarizeUsageRows(input.rows);
  const linkedInFile = input.rows.filter((row) =>
    row.cloudAgentId
      ? input.taskIdByCloudAgentId.has(row.cloudAgentId)
      : false,
  ).length;
  return {
    rowCountTotal: input.rows.length + input.errors.length + input.rowCountNoTokens,
    rowCountInserted: linkedFresh.length,
    rowCountDuplicate: deduped.duplicateCount,
    rowCountLinked: linkedInFile,
    rowCountErrors: input.errors.length,
    rowCountNoTokens: input.rowCountNoTokens,
    dateFrom: summary.dateFrom,
    dateTo: summary.dateTo,
    models: summary.models,
    totals: summary.totals,
    errors: input.errors.slice(0, USAGE_IMPORT_ERROR_LIMIT),
  };
}

export function aggregateLinkedUsage(
  rows: readonly Pick<
    NormalizedAiUsageRow,
    | 'occurredAt'
    | 'model'
    | 'maxMode'
    | 'tokensInput'
    | 'tokensCacheWrite'
    | 'tokensCache'
    | 'tokensOutput'
  >[],
): TaskUsageAggregate | 'overflow' | null {
  if (rows.length === 0) return null;
  let tokensInput = 0;
  let tokensOutput = 0;
  let tokensCache = 0;
  let tokensCacheWrite = 0;
  let latest = rows[0]!;
  for (const row of rows) {
    const nextInput = tokensInput + row.tokensInput;
    const nextOutput = tokensOutput + row.tokensOutput;
    const nextCache = tokensCache + row.tokensCache;
    const nextCacheWrite = tokensCacheWrite + row.tokensCacheWrite;
    if (
      nextInput > MAX_TOKEN_COUNT ||
      nextOutput > MAX_TOKEN_COUNT ||
      nextCache > MAX_TOKEN_COUNT ||
      nextCacheWrite > MAX_TOKEN_COUNT
    ) {
      return 'overflow';
    }
    tokensInput = nextInput;
    tokensOutput = nextOutput;
    tokensCache = nextCache;
    tokensCacheWrite = nextCacheWrite;
    if (row.occurredAt.getTime() >= latest.occurredAt.getTime()) {
      latest = row;
    }
  }
  const tokensUsed = tokensInput + tokensOutput + tokensCache + tokensCacheWrite;
  if (tokensUsed > MAX_TOKEN_COUNT) return 'overflow';
  const year = latest.occurredAt.getUTCFullYear();
  const month = String(latest.occurredAt.getUTCMonth() + 1).padStart(2, '0');
  return {
    tokensInput,
    tokensOutput,
    tokensCache,
    tokensCacheWrite,
    tokensUsed,
    modelId: latest.model,
    pricingTier: latest.maxMode == null ? null : latest.maxMode ? 'max' : 'standard',
    usageOccurredAt: latest.occurredAt,
    billingPeriod: `${year}-${month}`,
  };
}

function sameHeader(header: string[]): boolean {
  if (header.length !== CURSOR_USAGE_CSV_HEADERS.length) return false;
  return CURSOR_USAGE_CSV_HEADERS.every((name, index) => header[index] === name);
}

function parseCursorUsageRecord(
  record: CsvRecord,
): NormalizedAiUsageRow | { message: string } | { skipped: 'no_tokens' } {
  if (record.cells.length !== CURSOR_USAGE_CSV_HEADERS.length) {
    return { message: `Expected ${CURSOR_USAGE_CSV_HEADERS.length} columns` };
  }
  const [
    dateRaw,
    agentRaw,
    automationRaw,
    kindRaw,
    modelRaw,
    maxModeRaw,
    withCacheRaw,
    withoutCacheRaw,
    cacheRaw,
    outputRaw,
    totalRaw,
    costRaw,
  ] = record.cells;

  // Cursor leaves every token column blank on some Included/Free rows.
  // Those rows are not usage and are not malformed.
  if (
    [withCacheRaw, withoutCacheRaw, cacheRaw, outputRaw, totalRaw].every(
      (cell) => (cell ?? '').trim() === '',
    )
  ) {
    return { skipped: 'no_tokens' };
  }

  const occurredAtKey = dateRaw?.trim() ?? '';
  const occurredAt = new Date(occurredAtKey);
  if (!occurredAtKey || Number.isNaN(occurredAt.getTime())) {
    return { message: 'Date must be an ISO datetime' };
  }

  const cloudAgentId = optionalText(agentRaw ?? '', CLOUD_AGENT_ID_MAX, 'Cloud Agent ID');
  if (typeof cloudAgentId !== 'string' && cloudAgentId !== null) return cloudAgentId;
  const automationId = optionalText(automationRaw ?? '', AUTOMATION_MAX, 'Automation ID');
  if (typeof automationId !== 'string' && automationId !== null) return automationId;
  const kind = optionalText(kindRaw ?? '', KIND_MAX, 'Kind');
  if (typeof kind !== 'string' && kind !== null) return kind;
  const cost = optionalText(costRaw ?? '', COST_MAX, 'Cost');
  if (typeof cost !== 'string' && cost !== null) return cost;

  const model = (modelRaw ?? '').trim();
  if (!model) return { message: 'Model is required' };
  if (model.length > MODEL_MAX) return { message: 'Model is too long' };

  const maxMode = parseMaxMode(maxModeRaw ?? '');
  if (typeof maxMode !== 'boolean' && maxMode !== null) return maxMode;

  const inputWithCacheWrite = parseToken(withCacheRaw ?? '', 'Input (w/ Cache Write)');
  if (typeof inputWithCacheWrite !== 'number') return inputWithCacheWrite;
  const inputWithoutCacheWrite = parseToken(
    withoutCacheRaw ?? '',
    'Input (w/o Cache Write)',
  );
  if (typeof inputWithoutCacheWrite !== 'number') return inputWithoutCacheWrite;
  const cacheRead = parseToken(cacheRaw ?? '', 'Cache Read');
  if (typeof cacheRead !== 'number') return cacheRead;
  const outputTokens = parseToken(outputRaw ?? '', 'Output Tokens');
  if (typeof outputTokens !== 'number') return outputTokens;
  const totalTokens = parseToken(totalRaw ?? '', 'Total Tokens');
  if (typeof totalTokens !== 'number') return totalTokens;

  const mapped = mapCursorUsageTokens({
    inputWithCacheWrite,
    inputWithoutCacheWrite,
    cacheRead,
    outputTokens,
    totalTokens,
  });
  return {
    rowNumber: record.line,
    occurredAt,
    occurredAtKey,
    cloudAgentId,
    automationId,
    kind,
    model,
    maxMode,
    ...mapped,
    cost,
    rowHash: usageRowHash({
      occurredAtKey,
      cloudAgentId: cloudAgentId ?? '',
      model,
      tokensTotal: mapped.tokensTotal,
    }),
  };
}

function optionalText(
  raw: string,
  max: number,
  label: string,
): string | null | { message: string } {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.length > max) return { message: `${label} is too long` };
  if (label === 'Cloud Agent ID' && /\s/.test(trimmed)) {
    return { message: 'Cloud Agent ID cannot contain spaces' };
  }
  return trimmed;
}

function parseMaxMode(raw: string): boolean | null | { message: string } {
  const value = raw.trim().toLowerCase();
  if (!value) return null;
  if (value === 'yes' || value === 'true') return true;
  if (value === 'no' || value === 'false') return false;
  return { message: 'Max Mode must be Yes or No' };
}

function parseToken(raw: string, label: string): number | { message: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { message: `${label} is empty` };
  if (!/^\d+$/.test(trimmed)) return { message: `${label} must be a whole number` };
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value) || value > MAX_TOKEN_COUNT) {
    return { message: `${label} is too large` };
  }
  return value;
}

function parseCsvRecords(csv: string): CsvRecord[] {
  const src = csv.charCodeAt(0) === 0xfeff ? csv.slice(1) : csv;
  const records: CsvRecord[] = [];
  let cells: string[] = [];
  let field = '';
  let inQuotes = false;
  let line = 1;
  let rowLine = 1;
  for (let index = 0; index < src.length; index += 1) {
    const ch = src[index];
    if (inQuotes) {
      if (ch === '"') {
        if (src[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === '\n') line += 1;
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ',') {
      cells.push(field);
      field = '';
      continue;
    }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[index + 1] === '\n') index += 1;
      cells.push(field);
      field = '';
      if (cells.length > 1 || (cells[0] ?? '') !== '') {
        records.push({ line: rowLine, cells });
      }
      cells = [];
      line += 1;
      rowLine = line;
      continue;
    }
    field += ch;
  }
  if (field.length > 0 || cells.length > 0) {
    cells.push(field);
    if (cells.length > 1 || (cells[0] ?? '') !== '') {
      records.push({ line: rowLine, cells });
    }
  }
  return records;
}
