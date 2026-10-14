export const RACI_ROLES = ['A', 'R', 'C', 'I'] as const;

export type RaciRole = (typeof RACI_ROLES)[number];

export type RaciDraftEntry = {
  userId: string;
  role: RaciRole;
};

export type RaciDraftIssue =
  | 'exactly_one_accountable'
  | 'duplicate_person_role'
  | 'duplicate_person';

/** Standing RACI rules for the task dialog. The replace API is stricter on people. */
export function raciDraftIssues(
  entries: readonly RaciDraftEntry[],
): RaciDraftIssue[] {
  const issues: RaciDraftIssue[] = [];
  const accountable = entries.filter((entry) => entry.role === 'A').length;
  if (accountable !== 1) issues.push('exactly_one_accountable');

  const seenUsers = new Set<string>();
  const seenPairs = new Set<string>();
  let duplicatePerson = false;
  let duplicatePair = false;
  for (const entry of entries) {
    const pair = `${entry.userId}\0${entry.role}`;
    if (seenPairs.has(pair)) duplicatePair = true;
    seenPairs.add(pair);
    if (seenUsers.has(entry.userId)) duplicatePerson = true;
    seenUsers.add(entry.userId);
  }
  if (duplicatePair) issues.push('duplicate_person_role');
  if (duplicatePerson) issues.push('duplicate_person');
  return issues;
}

export function sameRaciDraft(
  left: readonly RaciDraftEntry[],
  right: readonly RaciDraftEntry[],
): boolean {
  const key = (entries: readonly RaciDraftEntry[]) =>
    [...entries]
      .map((entry) => `${entry.userId}:${entry.role}`)
      .sort()
      .join('|');
  return key(left) === key(right);
}
