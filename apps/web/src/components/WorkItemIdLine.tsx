import type { WorkItemType } from '../lib/work-item-label';

/** Kind word stays in the rail menu type. Only the item key is monospace. */
export function WorkItemIdLine({
  itemType,
  humanKey,
  taskLabel,
  bugLabel,
  milestoneLabel,
}: {
  itemType?: WorkItemType | null;
  humanKey?: string | null;
  taskLabel?: string;
  bugLabel?: string;
  milestoneLabel?: string;
}) {
  if (milestoneLabel != null) {
    return humanKey ? (
      <span className="kh-ops-key-badge">{humanKey}</span>
    ) : (
      <span className="kh-ops-menu-type">{milestoneLabel}</span>
    );
  }

  if (itemType === 'bug') {
    return (
      <span className="inline-flex min-w-0 flex-wrap items-center gap-1">
        {bugLabel ? <span className="kh-ops-menu-type">{bugLabel}</span> : null}
        {humanKey ? <span className="kh-ops-key-badge">{humanKey}</span> : null}
      </span>
    );
  }

  if (humanKey) return <span className="kh-ops-key-badge">{humanKey}</span>;
  if (taskLabel) return <span className="kh-ops-menu-type">{taskLabel}</span>;
  return null;
}
