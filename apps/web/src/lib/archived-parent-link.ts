export type ArchivedParentRef = {
  id: string;
  archivedAt?: string | null;
  humanKey?: string | null;
  title?: string | null;
  name?: string | null;
};

/**
 * Parent that blocks a new link because it is archived.
 * Keeping the current parent is allowed so an existing link can stay.
 */
export function archivedParentLinkTarget(input: {
  nextId: string;
  currentId?: string | null;
  parents: readonly ArchivedParentRef[];
}): { id: string; key: string } | null {
  if (!input.nextId || input.nextId === (input.currentId ?? '')) return null;
  const parent = input.parents.find((row) => row.id === input.nextId);
  if (!parent?.archivedAt) return null;
  const key = parent.humanKey || parent.title || parent.name || parent.id;
  return { id: parent.id, key };
}

/** True when an archived milestone's link set would change. */
export function milestoneLinkChangeBlocked(input: {
  archivedAt?: string | null;
  nextIds: readonly string[];
  currentIds: readonly string[];
}): boolean {
  if (!input.archivedAt) return false;
  const next = [...input.nextIds].sort().join('\n');
  const current = [...input.currentIds].sort().join('\n');
  return next !== current;
}
