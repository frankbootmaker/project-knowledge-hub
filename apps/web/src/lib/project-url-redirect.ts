export type IssueKeyQueryParam = 'task' | 'raid' | 'change';

const SECTION_HASH: Record<IssueKeyQueryParam, string> = {
  task: '#project-delivery',
  raid: '#project-raid',
  change: '#project-change',
};

/**
 * Replace one human-key query value with the entity id and open that section.
 * Other query values stay. The hash is the section that reads the param.
 */
export function replaceIssueKeyQuery(input: {
  pathname: string;
  task: string | null;
  raid: string | null;
  change: string | null;
  param: IssueKeyQueryParam;
  entityId: string;
}): string {
  const params = new URLSearchParams();
  if (input.task && input.param !== 'task') params.set('task', input.task);
  if (input.raid && input.param !== 'raid') params.set('raid', input.raid);
  if (input.change && input.param !== 'change') params.set('change', input.change);
  params.set(input.param, input.entityId);
  return `${input.pathname}?${params.toString()}${SECTION_HASH[input.param]}`;
}

/**
 * Swap the project slug segment and keep the rest of the path.
 * `/workspaces/acme/projects/outpost/records/a` -> `.../projects/relayhorizon/records/a`.
 * Returns null when the path is not that project's URL.
 */
export function replaceProjectSlugInPath(
  pathname: string,
  workspaceSlug: string,
  fromSlug: string,
  toSlug: string,
): string | null {
  const marker = `/workspaces/${workspaceSlug}/projects/${fromSlug}`;
  if (pathname !== marker && !pathname.startsWith(`${marker}/`)) {
    return null;
  }
  const next = `/workspaces/${workspaceSlug}/projects/${toSlug}`;
  return `${next}${pathname.slice(marker.length)}`;
}
