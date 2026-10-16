import { and, eq, inArray, or } from 'drizzle-orm';
import type { Database } from '@project-knowledge-hub/database';
import {
  knowledgeRecordRelations,
  knowledgeRecords,
} from '@project-knowledge-hub/database';
import {
  AppError,
  RECORD_RELATIONS_COMPACT_CAP,
  formatHumanKey,
  graphAfterRelationReplace,
  inverseKnowledgeRecordRelation,
  isCycleCheckedKnowledgeRecordRelation,
  knowledgeRecordRelationTypeSchema,
  normalizeStoredRelation,
  relationCyclePath,
  relationEdgeKey,
  relationReplacePlan,
  type KnowledgeRecordRelationType,
  type StoredRelationEdge,
} from '@project-knowledge-hub/domain';
import { loadProjectKeyPrefixMap } from './knowledge-records-service.js';

export type KnowledgeRecordRelationCard = {
  id: string;
  humanKey: string | null;
  title: string;
  slug: string;
  recordType: string;
  lifecycleStatus: string;
  archivedAt: string | null;
};

export type KnowledgeRecordRelationEdge = {
  relationType: string;
  record: KnowledgeRecordRelationCard;
};

export type KnowledgeRecordRelationsView = {
  relations: {
    outbound: KnowledgeRecordRelationEdge[];
    inbound: KnowledgeRecordRelationEdge[];
  };
  lifecycleSuccessor: KnowledgeRecordRelationCard | null;
  lifecyclePredecessor: KnowledgeRecordRelationCard | null;
};

export type CompactRecordRelationItem = {
  direction: 'outbound' | 'inbound';
  relationType: string;
  record: {
    id: string;
    humanKey: string | null;
    title: string;
    recordType: string;
    lifecycleStatus: string;
    archivedAt: string | null;
  };
};

export type CompactRecordRelations = {
  outboundCount: number;
  inboundCount: number;
  cap: number;
  truncated: boolean;
  items: CompactRecordRelationItem[];
};

type EndpointRow = {
  id: string;
  workspaceId: string;
  projectId: string | null;
  title: string;
  slug: string;
  recordType: string;
  lifecycleStatus: string;
  archivedAt: Date | null;
  documentKeyType: string | null;
  documentNumber: number | null;
  supersedesRecordId: string | null;
  updatedAt: Date;
};

const endpointColumns = {
  id: knowledgeRecords.id,
  workspaceId: knowledgeRecords.workspaceId,
  projectId: knowledgeRecords.projectId,
  title: knowledgeRecords.title,
  slug: knowledgeRecords.slug,
  recordType: knowledgeRecords.recordType,
  lifecycleStatus: knowledgeRecords.lifecycleStatus,
  archivedAt: knowledgeRecords.archivedAt,
  documentKeyType: knowledgeRecords.documentKeyType,
  documentNumber: knowledgeRecords.documentNumber,
  supersedesRecordId: knowledgeRecords.supersedesRecordId,
  updatedAt: knowledgeRecords.updatedAt,
};

const TYPE_ORDER: KnowledgeRecordRelationType[] = [
  'relates_to',
  'depends_on',
  'refines',
  'derived_from',
  'contradicts',
];

function typeRank(relationType: string): number {
  const index = TYPE_ORDER.indexOf(relationType as KnowledgeRecordRelationType);
  return index === -1 ? TYPE_ORDER.length : index;
}

async function loadEndpoints(
  database: Database,
  ids: string[],
): Promise<Map<string, EndpointRow>> {
  const unique = [...new Set(ids)];
  const map = new Map<string, EndpointRow>();
  if (unique.length === 0) return map;
  const rows = await database.db
    .select(endpointColumns)
    .from(knowledgeRecords)
    .where(inArray(knowledgeRecords.id, unique));
  for (const row of rows) map.set(row.id, row);
  return map;
}

function cardFor(
  row: EndpointRow,
  keyPrefix: string | null,
): KnowledgeRecordRelationCard {
  return {
    id: row.id,
    humanKey: formatHumanKey(keyPrefix, row.documentKeyType, row.documentNumber),
    title: row.title,
    slug: row.slug,
    recordType: row.recordType,
    lifecycleStatus: row.lifecycleStatus,
    archivedAt: row.archivedAt?.toISOString() ?? null,
  };
}

function assertSameScope(anchor: EndpointRow, target: EndpointRow): void {
  if (anchor.workspaceId !== target.workspaceId) {
    throw new AppError({
      code: 'RELATION_WORKSPACE_MISMATCH',
      message: 'Related records must belong to the same workspace',
      statusCode: 400,
    });
  }
  if (anchor.projectId !== target.projectId) {
    throw new AppError({
      code: 'RELATION_PROJECT_MISMATCH',
      message:
        'Related records must share the same project. A project record cannot relate to a workspace-only record.',
      statusCode: 400,
    });
  }
}

function edgeLabel(
  id: string,
  endpoints: Map<string, EndpointRow>,
  prefixes: Map<string, string | null>,
): string {
  const row = endpoints.get(id);
  if (!row) return id;
  const prefix = row.projectId ? prefixes.get(row.projectId) ?? null : null;
  return cardFor(row, prefix).humanKey ?? row.title;
}

async function loadWorkspaceEdges(
  database: Database,
  workspaceId: string,
  relationType: KnowledgeRecordRelationType,
): Promise<StoredRelationEdge[]> {
  const rows = await database.db
    .select({
      fromId: knowledgeRecordRelations.fromKnowledgeRecordId,
      toId: knowledgeRecordRelations.toKnowledgeRecordId,
      relationType: knowledgeRecordRelations.relationType,
    })
    .from(knowledgeRecordRelations)
    .where(
      and(
        eq(knowledgeRecordRelations.workspaceId, workspaceId),
        eq(knowledgeRecordRelations.relationType, relationType),
      ),
    );
  return rows.flatMap((row) => {
    const parsed = knowledgeRecordRelationTypeSchema.safeParse(row.relationType);
    if (!parsed.success) return [];
    return [
      {
        fromId: row.fromId,
        toId: row.toId,
        relationType: parsed.data,
      },
    ];
  });
}

function pickForward(
  rows: EndpointRow[],
): EndpointRow | null {
  if (rows.length === 0) return null;
  const current = rows.find((row) => row.lifecycleStatus === 'current');
  if (current) return current;
  return [...rows].sort(
    (left, right) => right.updatedAt.getTime() - left.updatedAt.getTime(),
  )[0] ?? null;
}

async function directSuccessors(
  database: Database,
  recordId: string,
): Promise<EndpointRow[]> {
  return database.db
    .select(endpointColumns)
    .from(knowledgeRecords)
    .where(eq(knowledgeRecords.supersedesRecordId, recordId));
}

async function lifecycleCards(
  database: Database,
  anchor: EndpointRow,
  prefixes: Map<string, string | null>,
): Promise<{
  successor: KnowledgeRecordRelationCard | null;
  predecessor: KnowledgeRecordRelationCard | null;
}> {
  let predecessor: KnowledgeRecordRelationCard | null = null;
  if (anchor.supersedesRecordId) {
    const loaded = await loadEndpoints(database, [anchor.supersedesRecordId]);
    const row = loaded.get(anchor.supersedesRecordId);
    if (row) {
      const prefix = row.projectId ? prefixes.get(row.projectId) ?? null : null;
      if (row.projectId && !prefixes.has(row.projectId)) {
        const extra = await loadProjectKeyPrefixMap(database, [row.projectId]);
        predecessor = cardFor(row, extra.get(row.projectId) ?? null);
      } else {
        predecessor = cardFor(row, prefix);
      }
    }
  }

  const seen = new Set<string>([anchor.id]);
  let cursor = anchor.id;
  let successorRow: EndpointRow | null = null;
  for (let depth = 0; depth < 20; depth += 1) {
    const next = pickForward(await directSuccessors(database, cursor));
    if (!next || seen.has(next.id)) break;
    seen.add(next.id);
    successorRow = next;
    if (next.lifecycleStatus === 'current') break;
    cursor = next.id;
  }

  let successor: KnowledgeRecordRelationCard | null = null;
  if (successorRow) {
    let prefix = successorRow.projectId
      ? prefixes.get(successorRow.projectId) ?? null
      : null;
    if (successorRow.projectId && !prefixes.has(successorRow.projectId)) {
      const extra = await loadProjectKeyPrefixMap(database, [
        successorRow.projectId,
      ]);
      prefix = extra.get(successorRow.projectId) ?? null;
    }
    successor = cardFor(successorRow, prefix);
  }

  return { successor, predecessor };
}

function viewFromEdges(
  anchorId: string,
  edges: StoredRelationEdge[],
  endpoints: Map<string, EndpointRow>,
  prefixes: Map<string, string | null>,
  lifecycle: {
    successor: KnowledgeRecordRelationCard | null;
    predecessor: KnowledgeRecordRelationCard | null;
  },
): KnowledgeRecordRelationsView {
  const outbound: KnowledgeRecordRelationEdge[] = [];
  const inbound: KnowledgeRecordRelationEdge[] = [];
  for (const edge of edges) {
    const otherId = edge.fromId === anchorId ? edge.toId : edge.fromId;
    const other = endpoints.get(otherId);
    if (!other) continue;
    const prefix = other.projectId ? prefixes.get(other.projectId) ?? null : null;
    const record = cardFor(other, prefix);
    if (edge.fromId === anchorId) {
      outbound.push({ relationType: edge.relationType, record });
    } else if (edge.toId === anchorId) {
      inbound.push({
        relationType: inverseKnowledgeRecordRelation(edge.relationType),
        record,
      });
    }
  }
  const byLabel = (
    left: KnowledgeRecordRelationEdge,
    right: KnowledgeRecordRelationEdge,
  ) => {
    const typeDelta = typeRank(left.relationType) - typeRank(right.relationType);
    if (typeDelta !== 0) return typeDelta;
    const key = (left.record.humanKey ?? left.record.title).localeCompare(
      right.record.humanKey ?? right.record.title,
    );
    return key;
  };
  outbound.sort(byLabel);
  inbound.sort(byLabel);
  return {
    relations: { outbound, inbound },
    lifecycleSuccessor: lifecycle.successor,
    lifecyclePredecessor: lifecycle.predecessor,
  };
}

export function toCompactRecordRelations(
  view: KnowledgeRecordRelationsView,
  cap = RECORD_RELATIONS_COMPACT_CAP,
): CompactRecordRelations {
  const items: CompactRecordRelationItem[] = [
    ...view.relations.outbound.map((edge) => ({
      direction: 'outbound' as const,
      relationType: edge.relationType,
      record: {
        id: edge.record.id,
        humanKey: edge.record.humanKey,
        title: edge.record.title,
        recordType: edge.record.recordType,
        lifecycleStatus: edge.record.lifecycleStatus,
        archivedAt: edge.record.archivedAt,
      },
    })),
    ...view.relations.inbound.map((edge) => ({
      direction: 'inbound' as const,
      relationType: edge.relationType,
      record: {
        id: edge.record.id,
        humanKey: edge.record.humanKey,
        title: edge.record.title,
        recordType: edge.record.recordType,
        lifecycleStatus: edge.record.lifecycleStatus,
        archivedAt: edge.record.archivedAt,
      },
    })),
  ];
  return {
    outboundCount: view.relations.outbound.length,
    inboundCount: view.relations.inbound.length,
    cap,
    truncated: items.length > cap,
    items: items.slice(0, cap),
  };
}

async function incidentEdges(
  database: Database,
  recordIds: string[],
): Promise<StoredRelationEdge[]> {
  if (recordIds.length === 0) return [];
  const rows = await database.db
    .select({
      fromId: knowledgeRecordRelations.fromKnowledgeRecordId,
      toId: knowledgeRecordRelations.toKnowledgeRecordId,
      relationType: knowledgeRecordRelations.relationType,
    })
    .from(knowledgeRecordRelations)
    .where(
      or(
        inArray(knowledgeRecordRelations.fromKnowledgeRecordId, recordIds),
        inArray(knowledgeRecordRelations.toKnowledgeRecordId, recordIds),
      ),
    );
  return rows.flatMap((row) => {
    const parsed = knowledgeRecordRelationTypeSchema.safeParse(row.relationType);
    if (!parsed.success) return [];
    return [
      {
        fromId: row.fromId,
        toId: row.toId,
        relationType: parsed.data,
      },
    ];
  });
}

export async function getKnowledgeRecordRelations(
  database: Database,
  recordId: string,
): Promise<KnowledgeRecordRelationsView> {
  const endpoints = await loadEndpoints(database, [recordId]);
  const anchor = endpoints.get(recordId);
  if (!anchor) {
    throw new AppError({
      code: 'KNOWLEDGE_RECORD_NOT_FOUND',
      message: 'Knowledge record not found',
      statusCode: 404,
    });
  }
  const edges = await incidentEdges(database, [recordId]);
  const peerIds = edges.flatMap((edge) =>
    edge.fromId === recordId ? [edge.toId] : [edge.fromId],
  );
  const peers = await loadEndpoints(database, peerIds);
  for (const [id, row] of peers) endpoints.set(id, row);
  const prefixes = await loadProjectKeyPrefixMap(database, [
    anchor.projectId,
    ...[...endpoints.values()].map((row) => row.projectId),
  ]);
  const lifecycle = await lifecycleCards(database, anchor, prefixes);
  return viewFromEdges(recordId, edges, endpoints, prefixes, lifecycle);
}

export async function compactRecordRelationsForRecords(
  database: Database,
  recordIds: string[],
): Promise<Map<string, CompactRecordRelations>> {
  const result = new Map<string, CompactRecordRelations>();
  const unique = [...new Set(recordIds)];
  const empty = toCompactRecordRelations({
    relations: { outbound: [], inbound: [] },
    lifecycleSuccessor: null,
    lifecyclePredecessor: null,
  });
  for (const id of unique) result.set(id, empty);
  if (unique.length === 0) return result;

  const edges = await incidentEdges(database, unique);
  const peerIds = new Set<string>(unique);
  for (const edge of edges) {
    peerIds.add(edge.fromId);
    peerIds.add(edge.toId);
  }
  const endpoints = await loadEndpoints(database, [...peerIds]);
  const prefixes = await loadProjectKeyPrefixMap(
    database,
    [...endpoints.values()].map((row) => row.projectId),
  );
  const wanted = new Set(unique);
  for (const id of unique) {
    const touching = edges.filter(
      (edge) => edge.fromId === id || edge.toId === id,
    );
    const view = viewFromEdges(id, touching, endpoints, prefixes, {
      successor: null,
      predecessor: null,
    });
    if (wanted.has(id)) result.set(id, toCompactRecordRelations(view));
  }
  return result;
}

export async function setKnowledgeRecordRelations(
  database: Database,
  input: {
    anchorId: string;
    links: Array<{ targetRecordId: string; relationType: string }>;
    createdBy?: string | null;
  },
): Promise<KnowledgeRecordRelationsView> {
  const anchorMap = await loadEndpoints(database, [input.anchorId]);
  const anchor = anchorMap.get(input.anchorId);
  if (!anchor) {
    throw new AppError({
      code: 'KNOWLEDGE_RECORD_NOT_FOUND',
      message: 'Knowledge record not found',
      statusCode: 404,
    });
  }
  if (anchor.archivedAt) {
    throw new AppError({
      code: 'RELATION_ARCHIVED',
      message: 'Archived records cannot change relations',
      statusCode: 400,
    });
  }

  const desiredByKey = new Map<string, StoredRelationEdge>();
  const parsedLinks: Array<{
    targetRecordId: string;
    relationType: KnowledgeRecordRelationType;
  }> = [];
  for (const link of input.links) {
    const parsed = knowledgeRecordRelationTypeSchema.safeParse(link.relationType);
    if (!parsed.success) {
      throw new AppError({
        code: 'VALIDATION_ERROR',
        message: `Invalid relation type: ${link.relationType}`,
        statusCode: 400,
      });
    }
    parsedLinks.push({
      targetRecordId: link.targetRecordId,
      relationType: parsed.data,
    });
  }

  const targetIds = [...new Set(parsedLinks.map((link) => link.targetRecordId))];
  const targets = await loadEndpoints(database, targetIds);
  for (const link of parsedLinks) {
    const target = targets.get(link.targetRecordId);
    if (!target) {
      throw new AppError({
        code: 'RELATION_TARGET_NOT_FOUND',
        message: 'Related knowledge record not found',
        statusCode: 400,
      });
    }
    assertSameScope(anchor, target);
    const edge = normalizeStoredRelation({
      anchorId: anchor.id,
      targetId: target.id,
      relationType: link.relationType,
    });
    desiredByKey.set(relationEdgeKey(edge), edge);
  }
  const desired = [...desiredByKey.values()];

  const existing = await incidentEdges(database, [anchor.id]);
  const plan = relationReplacePlan({
    anchorId: anchor.id,
    existing,
    desired,
  });

  const touchedIds = [
    ...plan.insertEdges.flatMap((edge) => [edge.fromId, edge.toId]),
    ...plan.deleteEdges.flatMap((edge) => [edge.fromId, edge.toId]),
  ].filter((id) => id !== anchor.id);
  const touched = await loadEndpoints(database, touchedIds);
  for (const [id, row] of targets) touched.set(id, row);

  for (const edge of plan.insertEdges) {
    const otherId = edge.fromId === anchor.id ? edge.toId : edge.fromId;
    const other = touched.get(otherId);
    if (other?.archivedAt) {
      throw new AppError({
        code: 'RELATION_ARCHIVED',
        message: 'Cannot add a relation that touches an archived record',
        statusCode: 400,
      });
    }
  }
  for (const edge of plan.deleteEdges) {
    const otherId = edge.fromId === anchor.id ? edge.toId : edge.fromId;
    const other = touched.get(otherId);
    if (other?.archivedAt) {
      throw new AppError({
        code: 'RELATION_ARCHIVED',
        message: 'Cannot change a relation that touches an archived record',
        statusCode: 400,
      });
    }
  }

  for (const relationType of ['depends_on', 'refines'] as const) {
    const workspaceEdges = await loadWorkspaceEdges(
      database,
      anchor.workspaceId,
      relationType,
    );
    const next = graphAfterRelationReplace({
      anchorId: anchor.id,
      relationType,
      existing: workspaceEdges,
      desired,
    });
    if (!isCycleCheckedKnowledgeRecordRelation(relationType)) continue;
    const cycle = relationCyclePath(next);
    if (!cycle) continue;
    const cycleIds = [...new Set(cycle)];
    const cycleEndpoints = await loadEndpoints(database, cycleIds);
    for (const [id, row] of touched) cycleEndpoints.set(id, row);
    cycleEndpoints.set(anchor.id, anchor);
    const prefixes = await loadProjectKeyPrefixMap(
      database,
      [...cycleEndpoints.values()].map((row) => row.projectId),
    );
    const path = cycle
      .map((id) => edgeLabel(id, cycleEndpoints, prefixes))
      .join(' → ');
    throw new AppError({
      code: 'RELATION_CYCLE',
      message: `This ${relationType.replaceAll('_', ' ')} link would create a cycle: ${path}.`,
      statusCode: 400,
    });
  }

  const existingRows = await database.db
    .select({
      id: knowledgeRecordRelations.id,
      fromId: knowledgeRecordRelations.fromKnowledgeRecordId,
      toId: knowledgeRecordRelations.toKnowledgeRecordId,
      relationType: knowledgeRecordRelations.relationType,
    })
    .from(knowledgeRecordRelations)
    .where(eq(knowledgeRecordRelations.fromKnowledgeRecordId, anchor.id));

  const deleteKeys = new Set(plan.deleteEdges.map(relationEdgeKey));
  const deleteIds = existingRows.flatMap((row) => {
    const parsed = knowledgeRecordRelationTypeSchema.safeParse(row.relationType);
    if (!parsed.success) return [];
    const key = relationEdgeKey({
      fromId: row.fromId,
      toId: row.toId,
      relationType: parsed.data,
    });
    return deleteKeys.has(key) ? [row.id] : [];
  });

  await database.db.transaction(async (tx) => {
    if (deleteIds.length > 0) {
      await tx
        .delete(knowledgeRecordRelations)
        .where(inArray(knowledgeRecordRelations.id, deleteIds));
    }
    if (plan.insertEdges.length > 0) {
      await tx.insert(knowledgeRecordRelations).values(
        plan.insertEdges.map((edge) => ({
          workspaceId: anchor.workspaceId,
          fromKnowledgeRecordId: edge.fromId,
          toKnowledgeRecordId: edge.toId,
          relationType: edge.relationType,
          createdBy: input.createdBy ?? null,
        })),
      );
    }
  });

  return getKnowledgeRecordRelations(database, anchor.id);
}

export function relationAuditMetadata(input: {
  projectId: string | null;
  links: Array<{ relationType: string }>;
}): { projectId: string | null; linkCount: number; relationTypes: string[] } {
  return {
    projectId: input.projectId,
    linkCount: input.links.length,
    relationTypes: [...new Set(input.links.map((link) => link.relationType))],
  };
}
