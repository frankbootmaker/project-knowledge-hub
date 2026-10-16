export const LINKED_ITEM_GROUP_ORDER = [
  'epic',
  'user_story',
  'milestone',
  'task',
  'bug',
  'sprint',
  'raid',
  'change',
] as const;

export type LinkedItemGroup = (typeof LINKED_ITEM_GROUP_ORDER)[number];

/** Bugs stay delivery type `task` and group under Bug. */
export function linkedItemGroup(item: {
  type: string;
  kind: string | null;
}): LinkedItemGroup | string {
  if (item.type === 'task' && item.kind === 'bug') return 'bug';
  return item.type;
}

/**
 * Project URL for a linked item.
 * RAID opens with `?raid=`. Tasks and bugs use the delivery `?task=` link.
 * Sprints open the scrum view. Epics, stories, and milestones open Delivery.
 * Change items open the change section. Those sections have no item query.
 */
export function knowledgeRecordItemHref(input: {
  workspaceSlug: string;
  projectSlug: string;
  type: string;
  kind: string | null;
  id: string;
}): string {
  const base = `/workspaces/${input.workspaceSlug}/projects/${input.projectSlug}`;
  const id = encodeURIComponent(input.id);
  if (input.type === 'raid') {
    return `${base}?raid=${id}#project-raid`;
  }
  if (input.type === 'change') {
    return `${base}#project-change`;
  }
  if (input.type === 'task') {
    return `${base}?task=${id}#project-delivery`;
  }
  if (input.type === 'sprint') {
    return `${base}?delivery=scrum#project-delivery`;
  }
  return `${base}#project-delivery`;
}
