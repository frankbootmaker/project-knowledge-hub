import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Database } from '@project-knowledge-hub/database';
import {
  knowledgeRecordDeliveryLinks,
  projectChangeItems,
  projectChangeRecordLinks,
  projectEpics,
  projectMilestones,
  projectRaidItems,
  projectRaidRecordLinks,
  projectSprints,
  projectTasks,
  projectUserStories,
  projects,
} from '@project-knowledge-hub/database';
import { formatHumanKey } from '@project-knowledge-hub/domain';
import { getKnowledgeRecordProjectContext } from './knowledge-delivery-links.js';

export const RECORD_LINKED_ITEM_TYPES = [
  'epic',
  'user_story',
  'milestone',
  'task',
  'sprint',
  'raid',
  'change',
] as const;

export type RecordLinkedItemType = (typeof RECORD_LINKED_ITEM_TYPES)[number];

/** One delivery, RAID, or change item linked back to a knowledge record. */
export type RecordLinkedItem = {
  id: string;
  humanKey: string | null;
  title: string;
  type: RecordLinkedItemType;
  /** Task item type, RAID kind, or change kind. Null for other delivery types. */
  kind: string | null;
  projectId: string;
  projectSlug: string;
};

export type KnowledgeRecordLinkedItems = {
  deliveryLinks: RecordLinkedItem[];
  raidLinks: RecordLinkedItem[];
  changeItems: RecordLinkedItem[];
};

const TYPE_ORDER: Record<RecordLinkedItemType, number> = {
  epic: 0,
  user_story: 1,
  milestone: 2,
  task: 3,
  sprint: 4,
  raid: 5,
  change: 6,
};

type ItemRow = {
  id: string;
  title: string;
  issueKeyType: string | null;
  issueNumber: number | null;
  kind: string | null;
};

function emptyLinkedItems(): KnowledgeRecordLinkedItems {
  return { deliveryLinks: [], raidLinks: [], changeItems: [] };
}

function toItem(
  row: ItemRow,
  type: RecordLinkedItemType,
  project: { id: string; slug: string; keyPrefix: string | null },
): RecordLinkedItem {
  return {
    id: row.id,
    humanKey: formatHumanKey(project.keyPrefix, row.issueKeyType, row.issueNumber),
    title: row.title,
    type,
    kind: row.kind,
    projectId: project.id,
    projectSlug: project.slug,
  };
}

function sortItems(items: RecordLinkedItem[]): RecordLinkedItem[] {
  return [...items].sort((left, right) => {
    const typeCmp = TYPE_ORDER[left.type] - TYPE_ORDER[right.type];
    if (typeCmp !== 0) return typeCmp;
    const bugCmp = Number(left.kind === 'bug') - Number(right.kind === 'bug');
    if (bugCmp !== 0) return bugCmp;
    const keyCmp = (left.humanKey ?? '\uffff').localeCompare(right.humanKey ?? '\uffff');
    if (keyCmp !== 0) return keyCmp;
    return left.title.localeCompare(right.title);
  });
}

async function listDeliveryItems(
  database: Database,
  recordId: string,
  project: { id: string; slug: string; keyPrefix: string | null },
): Promise<RecordLinkedItem[]> {
  const links = await database.db
    .select({
      entityType: knowledgeRecordDeliveryLinks.entityType,
      entityId: knowledgeRecordDeliveryLinks.entityId,
    })
    .from(knowledgeRecordDeliveryLinks)
    .where(eq(knowledgeRecordDeliveryLinks.knowledgeRecordId, recordId));

  const ids = (entityType: string) =>
    links.filter((link) => link.entityType === entityType).map((link) => link.entityId);
  const epicIds = ids('epic');
  const storyIds = ids('user_story');
  const milestoneIds = ids('milestone');
  const taskIds = ids('task');
  const sprintIds = ids('sprint');
  const db = database.db;

  const [epics, stories, milestones, tasks, sprints] = await Promise.all([
    epicIds.length === 0
      ? []
      : db
          .select({
            id: projectEpics.id,
            title: projectEpics.title,
            issueKeyType: projectEpics.issueKeyType,
            issueNumber: projectEpics.issueNumber,
          })
          .from(projectEpics)
          .where(
            and(
              eq(projectEpics.projectId, project.id),
              inArray(projectEpics.id, epicIds),
              isNull(projectEpics.archivedAt),
            ),
          ),
    storyIds.length === 0
      ? []
      : db
          .select({
            id: projectUserStories.id,
            title: projectUserStories.title,
            issueKeyType: projectUserStories.issueKeyType,
            issueNumber: projectUserStories.issueNumber,
          })
          .from(projectUserStories)
          .where(
            and(
              eq(projectUserStories.projectId, project.id),
              inArray(projectUserStories.id, storyIds),
              isNull(projectUserStories.archivedAt),
            ),
          ),
    milestoneIds.length === 0
      ? []
      : db
          .select({
            id: projectMilestones.id,
            title: projectMilestones.title,
            issueKeyType: projectMilestones.issueKeyType,
            issueNumber: projectMilestones.issueNumber,
          })
          .from(projectMilestones)
          .where(
            and(
              eq(projectMilestones.projectId, project.id),
              inArray(projectMilestones.id, milestoneIds),
              isNull(projectMilestones.archivedAt),
            ),
          ),
    taskIds.length === 0
      ? []
      : db
          .select({
            id: projectTasks.id,
            title: projectTasks.title,
            issueKeyType: projectTasks.issueKeyType,
            issueNumber: projectTasks.issueNumber,
            kind: projectTasks.itemType,
          })
          .from(projectTasks)
          .where(
            and(
              eq(projectTasks.projectId, project.id),
              inArray(projectTasks.id, taskIds),
              isNull(projectTasks.archivedAt),
            ),
          ),
    sprintIds.length === 0
      ? []
      : db
          .select({
            id: projectSprints.id,
            title: projectSprints.name,
            issueKeyType: projectSprints.issueKeyType,
            issueNumber: projectSprints.issueNumber,
          })
          .from(projectSprints)
          .where(
            and(
              eq(projectSprints.projectId, project.id),
              inArray(projectSprints.id, sprintIds),
              isNull(projectSprints.archivedAt),
            ),
          ),
  ]);

  const plain = (rows: Array<Omit<ItemRow, 'kind'>>, type: RecordLinkedItemType) =>
    rows.map((row) => toItem({ ...row, kind: null }, type, project));

  return sortItems([
    ...plain(epics, 'epic'),
    ...plain(stories, 'user_story'),
    ...plain(milestones, 'milestone'),
    ...tasks.map((row) => toItem(row, 'task', project)),
    ...plain(sprints, 'sprint'),
  ]);
}

async function listRaidItems(
  database: Database,
  recordId: string,
  project: { id: string; slug: string; keyPrefix: string | null },
): Promise<RecordLinkedItem[]> {
  const rows = await database.db
    .select({
      id: projectRaidItems.id,
      title: projectRaidItems.title,
      kind: projectRaidItems.kind,
      issueKeyType: projectRaidItems.issueKeyType,
      issueNumber: projectRaidItems.issueNumber,
    })
    .from(projectRaidRecordLinks)
    .innerJoin(projectRaidItems, eq(projectRaidRecordLinks.raidItemId, projectRaidItems.id))
    .where(
      and(
        eq(projectRaidRecordLinks.knowledgeRecordId, recordId),
        eq(projectRaidItems.projectId, project.id),
        isNull(projectRaidItems.archivedAt),
      ),
    );
  return sortItems(rows.map((row) => toItem(row, 'raid', project)));
}

async function listChangeItems(
  database: Database,
  recordId: string,
  project: { id: string; slug: string; keyPrefix: string | null },
): Promise<RecordLinkedItem[]> {
  const linked = await database.db
    .select({
      id: projectChangeItems.id,
      title: projectChangeItems.title,
      kind: projectChangeItems.kind,
      issueKeyType: projectChangeItems.issueKeyType,
      issueNumber: projectChangeItems.issueNumber,
    })
    .from(projectChangeRecordLinks)
    .innerJoin(projectChangeItems, eq(projectChangeRecordLinks.changeId, projectChangeItems.id))
    .where(
      and(
        eq(projectChangeRecordLinks.knowledgeRecordId, recordId),
        eq(projectChangeItems.projectId, project.id),
        isNull(projectChangeItems.archivedAt),
      ),
    );

  const legacy = await database.db
    .select({
      id: projectChangeItems.id,
      title: projectChangeItems.title,
      kind: projectChangeItems.kind,
      issueKeyType: projectChangeItems.issueKeyType,
      issueNumber: projectChangeItems.issueNumber,
    })
    .from(projectChangeItems)
    .where(
      and(
        eq(projectChangeItems.knowledgeRecordId, recordId),
        eq(projectChangeItems.projectId, project.id),
        isNull(projectChangeItems.archivedAt),
      ),
    );

  const byId = new Map<string, ItemRow>();
  for (const row of [...linked, ...legacy]) {
    byId.set(row.id, row);
  }
  return sortItems([...byId.values()].map((row) => toItem(row, 'change', project)));
}

/**
 * Reverse links for one knowledge record: delivery items, RAID items, and
 * change items in that record's project. Archived rows are omitted.
 * Callers must already have checked that the reader can see the record.
 */
export async function listKnowledgeRecordLinkedItems(
  database: Database,
  recordId: string,
): Promise<KnowledgeRecordLinkedItems> {
  const record = await getKnowledgeRecordProjectContext(database, recordId);
  if (!record.projectId) return emptyLinkedItems();

  const [project] = await database.db
    .select({
      id: projects.id,
      slug: projects.slug,
      keyPrefix: projects.keyPrefix,
    })
    .from(projects)
    .where(eq(projects.id, record.projectId))
    .limit(1);
  if (!project) return emptyLinkedItems();

  const [deliveryLinks, raidLinks, changeItems] = await Promise.all([
    listDeliveryItems(database, record.id, project),
    listRaidItems(database, record.id, project),
    listChangeItems(database, record.id, project),
  ]);
  return { deliveryLinks, raidLinks, changeItems };
}
