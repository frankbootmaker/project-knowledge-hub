import type { WorkItemType } from '../lib/work-item-label';
import { DeliveryItemIdButton } from './DeliveryItemIdButton';

function HumanKeyBadge({
  humanKey,
  onOpen,
}: {
  humanKey: string;
  onOpen?: () => void;
}) {
  if (onOpen) {
    return (
      <DeliveryItemIdButton variant="key" onClick={onOpen}>
        {humanKey}
      </DeliveryItemIdButton>
    );
  }
  return <span className="kh-ops-key-badge">{humanKey}</span>;
}

/** Kind word stays in the rail menu type. Only the item key is monospace. */
export function WorkItemIdLine({
  itemType,
  humanKey,
  taskLabel,
  bugLabel,
  milestoneLabel,
  onHumanKeyOpen,
}: {
  itemType?: WorkItemType | null;
  humanKey?: string | null;
  taskLabel?: string;
  bugLabel?: string;
  milestoneLabel?: string;
  onHumanKeyOpen?: () => void;
}) {
  if (milestoneLabel != null) {
    return humanKey ? (
      <HumanKeyBadge humanKey={humanKey} onOpen={onHumanKeyOpen} />
    ) : (
      <span className="kh-ops-menu-type">{milestoneLabel}</span>
    );
  }

  if (itemType === 'bug') {
    return (
      <span className="inline-flex min-w-0 flex-wrap items-center gap-1">
        {bugLabel ? <span className="kh-ops-menu-type">{bugLabel}</span> : null}
        {humanKey ? (
          <HumanKeyBadge humanKey={humanKey} onOpen={onHumanKeyOpen} />
        ) : null}
      </span>
    );
  }

  if (humanKey) {
    return <HumanKeyBadge humanKey={humanKey} onOpen={onHumanKeyOpen} />;
  }
  if (taskLabel) return <span className="kh-ops-menu-type">{taskLabel}</span>;
  return null;
}
