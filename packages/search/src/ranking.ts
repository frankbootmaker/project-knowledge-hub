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

export const DEFAULT_EXCLUDED_LIFECYCLE_STATUSES = [
  'deprecated',
  'superseded',
  'archived',
] as const;
