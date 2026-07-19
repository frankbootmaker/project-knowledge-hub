export type WorkspaceHealthKind = 'healthy' | 'archived' | 'needs_attention';

export type WorkspaceStatus = {
  kind: WorkspaceHealthKind;
  /** Worst git sync health when attention is needed (for detail label). */
  gitHealth: string | null;
  /** Where to go when the status is clickable (needs attention). */
  attentionHref: string | null;
};

const ATTENTION_GIT: Record<string, number> = {
  error: 5,
  needs_sync: 4,
  never_synced: 3,
  check_failed: 2,
  paused: 1,
};

export function worstGitHealth(
  statuses: Array<string | null | undefined>,
): string | null {
  let worst: string | null = null;
  for (const status of statuses) {
    if (!status) continue;
    if (worst == null || (ATTENTION_GIT[status] ?? 0) > (ATTENTION_GIT[worst] ?? 0)) {
      worst = status;
    }
  }
  return worst;
}

export function resolveWorkspaceStatus(input: {
  archived: boolean;
  workspaceSlug: string;
  gitHealthStatuses: Array<string | null | undefined>;
}): WorkspaceStatus {
  if (input.archived) {
    return {
      kind: 'archived',
      gitHealth: null,
      attentionHref: null,
    };
  }

  const gitHealth = worstGitHealth(input.gitHealthStatuses);
  const needsAttention =
    gitHealth != null && Object.prototype.hasOwnProperty.call(ATTENTION_GIT, gitHealth);

  if (needsAttention) {
    return {
      kind: 'needs_attention',
      gitHealth,
      attentionHref: `/workspaces/${input.workspaceSlug}/git`,
    };
  }

  return {
    kind: 'healthy',
    gitHealth: gitHealth === 'healthy' ? 'healthy' : null,
    attentionHref: null,
  };
}
