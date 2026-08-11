import { z } from 'zod';

type RaidKind = 'risk' | 'assumption' | 'issue' | 'dependency';

/** Type codes embedded in human-readable issue keys. */
export const ISSUE_KEY_TYPES = [
  'E',
  'S',
  'M',
  'T',
  'C',
  'RR',
  'RI',
  'RA',
  'RD',
] as const;

export type IssueKeyType = (typeof ISSUE_KEY_TYPES)[number];

export const issueKeyTypeSchema = z.enum(ISSUE_KEY_TYPES);

/** AAA or AA0 (two letters + digit). */
export const KEY_PREFIX_PATTERN = /^([A-Z]{3}|[A-Z]{2}[0-9])$/;

export const HUMAN_KEY_PATTERN =
  /^([A-Z]{3}|[A-Z]{2}[0-9])-(E|S|M|T|C|RR|RI|RA|RD)-([1-9][0-9]*)$/;

export const keyPrefixSchema = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .refine((value) => KEY_PREFIX_PATTERN.test(value), {
    message: 'Key prefix must be AAA or AA0 (two letters + digit)',
  });

export type ParsedHumanKey = {
  prefix: string;
  issueKeyType: IssueKeyType;
  issueNumber: number;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value.trim());
}

export function normalizeKeyPrefix(raw: string): string {
  return raw.trim().toUpperCase();
}

export function isValidKeyPrefix(value: string): boolean {
  return KEY_PREFIX_PATTERN.test(normalizeKeyPrefix(value));
}

/**
 * Suggest a 3-char prefix from a project name or slug.
 * Prefers letters from the source; pads with a digit when needed.
 */
export function suggestKeyPrefix(nameOrSlug: string): string {
  const cleaned = nameOrSlug
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
  const letters = cleaned.replace(/[^A-Z]/g, '');
  const alnum = cleaned.replace(/[^A-Z0-9]/g, '');

  if (letters.length >= 3) {
    return letters.slice(0, 3);
  }

  if (letters.length === 2) {
    const digit = alnum.match(/[0-9]/)?.[0] ?? '1';
    return `${letters}${digit}`;
  }

  if (letters.length === 1) {
    const rest = alnum.replace(/[^A-Z0-9]/g, '').slice(1);
    const second = (rest.match(/[A-Z]/)?.[0] ?? 'X') as string;
    const digit = rest.match(/[0-9]/)?.[0] ?? '1';
    return `${letters}${second}${digit}`.slice(0, 3);
  }

  if (alnum.length >= 3) {
    const candidate = alnum.slice(0, 3);
    if (KEY_PREFIX_PATTERN.test(candidate)) return candidate;
    const onlyLetters = candidate.replace(/[^A-Z]/g, '').padEnd(2, 'X').slice(0, 2);
    const digit = candidate.match(/[0-9]/)?.[0] ?? '1';
    return `${onlyLetters}${digit}`;
  }

  return 'PRJ';
}

export function parseHumanKey(raw: string): ParsedHumanKey | null {
  const match = raw.trim().toUpperCase().match(HUMAN_KEY_PATTERN);
  if (!match) return null;
  return {
    prefix: match[1]!,
    issueKeyType: match[2] as IssueKeyType,
    issueNumber: Number(match[3]),
  };
}

export function formatHumanKey(
  prefix: string | null | undefined,
  issueKeyType: string | null | undefined,
  issueNumber: number | null | undefined,
): string | null {
  if (!prefix || !issueKeyType || issueNumber == null || issueNumber < 1) {
    return null;
  }
  const normalized = normalizeKeyPrefix(prefix);
  if (!KEY_PREFIX_PATTERN.test(normalized)) return null;
  if (!issueKeyTypeSchema.safeParse(issueKeyType).success) return null;
  return `${normalized}-${issueKeyType}-${issueNumber}`;
}

export function raidKindToIssueKeyType(kind: RaidKind): IssueKeyType {
  switch (kind) {
    case 'risk':
      return 'RR';
    case 'issue':
      return 'RI';
    case 'assumption':
      return 'RA';
    case 'dependency':
      return 'RD';
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

export function issueKeyTypeToRaidKind(type: IssueKeyType): RaidKind | null {
  switch (type) {
    case 'RR':
      return 'risk';
    case 'RI':
      return 'issue';
    case 'RA':
      return 'assumption';
    case 'RD':
      return 'dependency';
    default:
      return null;
  }
}

export type IssueCounters = Partial<Record<IssueKeyType, number>>;

export function readIssueCounter(
  counters: unknown,
  type: IssueKeyType,
): number {
  if (!counters || typeof counters !== 'object') return 0;
  const value = (counters as Record<string, unknown>)[type];
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;
}
