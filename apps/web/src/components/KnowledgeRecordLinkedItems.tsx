import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import {
  LINKED_ITEM_GROUP_ORDER,
  knowledgeRecordItemHref,
  linkedItemGroup,
} from '../lib/knowledge-record-item-href';

export type KnowledgeRecordLinkedItem = {
  id: string;
  humanKey: string | null;
  title: string;
  type: string;
  kind: string | null;
  projectId: string;
  projectSlug: string;
};

export type KnowledgeRecordLinkedItemsPayload = {
  deliveryLinks: KnowledgeRecordLinkedItem[];
  raidLinks: KnowledgeRecordLinkedItem[];
  changeItems: KnowledgeRecordLinkedItem[];
};

function groupLabel(group: string, t: Awaited<ReturnType<typeof getTranslations>>): string {
  switch (group) {
    case 'epic':
      return t('linkedItemTypes.epic');
    case 'user_story':
      return t('linkedItemTypes.user_story');
    case 'milestone':
      return t('linkedItemTypes.milestone');
    case 'task':
      return t('linkedItemTypes.task');
    case 'bug':
      return t('linkedItemTypes.bug');
    case 'sprint':
      return t('linkedItemTypes.sprint');
    case 'raid':
      return t('linkedItemTypes.raid');
    case 'change':
      return t('linkedItemTypes.change');
    default:
      return group;
  }
}

export async function KnowledgeRecordLinkedItems({
  workspaceSlug,
  linkedItems,
}: {
  workspaceSlug: string;
  linkedItems: KnowledgeRecordLinkedItemsPayload;
}) {
  const t = await getTranslations('records');
  const items = [
    ...linkedItems.deliveryLinks,
    ...linkedItems.raidLinks,
    ...linkedItems.changeItems,
  ];
  const groups = new Map<string, KnowledgeRecordLinkedItem[]>();
  for (const item of items) {
    const group = linkedItemGroup(item);
    const list = groups.get(group) ?? [];
    list.push(item);
    groups.set(group, list);
  }
  const ordered = [
    ...LINKED_ITEM_GROUP_ORDER.filter((group) => groups.has(group)),
    ...[...groups.keys()].filter(
      (group) => !(LINKED_ITEM_GROUP_ORDER as readonly string[]).includes(group),
    ),
  ];

  return (
    <div className="grid gap-2">
      <h3 className="kh-ops-panel-title m-0">{t('linkedItems')}</h3>
      {items.length === 0 ? (
        <p className="kh-ops-empty px-0 py-0">{t('linkedItemsEmpty')}</p>
      ) : (
        ordered.map((group) => (
          <div key={group} className="grid gap-1">
            <p className="kh-ops-panel-meta m-0">{groupLabel(group, t)}</p>
            <ul className="m-0 grid list-none gap-1 p-0">
              {(groups.get(group) ?? []).map((item) => {
                const href = item.projectSlug
                  ? knowledgeRecordItemHref({
                      workspaceSlug,
                      projectSlug: item.projectSlug,
                      type: item.type,
                      kind: item.kind,
                      id: item.id,
                    })
                  : null;
                const label = (
                  <>
                    {item.humanKey ? (
                      <span className="kh-ops-key-badge">{item.humanKey}</span>
                    ) : null}
                    <span>{item.title}</span>
                  </>
                );
                return (
                  <li key={`${item.type}:${item.id}`}>
                    {href ? (
                      <Link
                        href={href}
                        className="kh-text-link inline-flex flex-wrap items-center gap-2"
                      >
                        {label}
                      </Link>
                    ) : (
                      <span className="inline-flex flex-wrap items-center gap-2">{label}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))
      )}
    </div>
  );
}
