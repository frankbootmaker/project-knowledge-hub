export function sortWorkspacesByName<T extends { name: string }>(
  workspaces: readonly T[],
  locale: string,
): T[] {
  const collator = new Intl.Collator(locale, { sensitivity: 'base' });
  return [...workspaces].sort((left, right) => collator.compare(left.name, right.name));
}
