/** Path of a knowledge record, optionally nested under a project. */
export function recordHref(input: {
  workspaceSlug: string;
  projectSlug?: string | null;
  recordSlug: string;
  suffix?: string;
}): string {
  const nested = Boolean(input.projectSlug) && input.projectSlug !== 'new';
  const root = nested
    ? `/workspaces/${input.workspaceSlug}/projects/${input.projectSlug}/records/${input.recordSlug}`
    : `/workspaces/${input.workspaceSlug}/records/${input.recordSlug}`;
  if (!input.suffix) {
    return root;
  }
  const suffix = input.suffix.startsWith('/') ? input.suffix : `/${input.suffix}`;
  return `${root}${suffix}`;
}

/** Swap the record slug on a `.../records/<slug>` base path. */
export function recordBaseWithSlug(recordBasePath: string, recordSlug: string): string {
  const hashIndex = recordBasePath.indexOf('#');
  const path = hashIndex === -1 ? recordBasePath : recordBasePath.slice(0, hashIndex);
  const hash = hashIndex === -1 ? '' : recordBasePath.slice(hashIndex);
  const slash = path.lastIndexOf('/');
  return `${path.slice(0, slash + 1)}${recordSlug}${hash}`;
}
