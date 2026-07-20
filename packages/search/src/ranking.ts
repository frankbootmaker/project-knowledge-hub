/** Lifecycle multipliers applied on top of PostgreSQL ts_rank. */
export function lifecycleRankBoost(lifecycleStatus: string): number {
  switch (lifecycleStatus) {
    case 'current':
      return 1.55;
    case 'verified':
      return 1.35;
    case 'review_required':
      return 1.05;
    case 'draft':
      return 0.75;
    case 'superseded':
    case 'deprecated':
    case 'archived':
      return 0.4;
    default:
      return 1;
  }
}

/** Extra boost when the query matches the title closely. */
export function titleMatchBoost(title: string, query: string): number {
  const normalizedTitle = title.trim().toLowerCase();
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return 0;
  }
  if (normalizedTitle === normalizedQuery) {
    return 2.5;
  }
  if (normalizedTitle.includes(normalizedQuery)) {
    return 1.25;
  }
  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
  if (tokens.length > 0 && tokens.every((token) => normalizedTitle.includes(token))) {
    return 0.85;
  }
  return 0;
}

export function combineSearchScore(options: {
  tsRank: number;
  title: string;
  query: string;
  lifecycleStatus: string;
}): number {
  const base = Math.max(options.tsRank, 0.0001);
  return (
    base * lifecycleRankBoost(options.lifecycleStatus) +
    titleMatchBoost(options.title, options.query)
  );
}

/**
 * Blend lexical FTS score with vector similarity (0–1 cosine-like).
 * When vectorScore is absent, falls back to FTS-only combine.
 */
export function combineHybridScore(options: {
  tsRank: number;
  vectorScore?: number | null;
  title: string;
  query: string;
  lifecycleStatus: string;
  ftsWeight?: number;
  vectorWeight?: number;
}): number {
  const ftsWeight = options.ftsWeight ?? 0.55;
  const vectorWeight = options.vectorWeight ?? 0.45;
  const ftsScore = combineSearchScore({
    tsRank: options.tsRank,
    title: options.title,
    query: options.query,
    lifecycleStatus: options.lifecycleStatus,
  });
  if (options.vectorScore == null || Number.isNaN(options.vectorScore)) {
    return ftsScore;
  }
  const vector = Math.max(0, Math.min(1, options.vectorScore));
  const lifecycle = lifecycleRankBoost(options.lifecycleStatus);
  return (
    ftsWeight * ftsScore +
    vectorWeight * (vector * 3 * lifecycle) +
    titleMatchBoost(options.title, options.query) * 0.25
  );
}

export const DEFAULT_EXCLUDED_LIFECYCLE_STATUSES = [
  'deprecated',
  'superseded',
  'archived',
] as const;
