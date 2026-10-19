import { z } from 'zod';
import { AppError } from './index.js';

/** Stored forward types. Inverse names are a read model only. */
export const KNOWLEDGE_RECORD_RELATION_TYPES = [
  'relates_to',
  'depends_on',
  'refines',
  'derived_from',
  'contradicts',
] as const;

export type KnowledgeRecordRelationType =
  (typeof KNOWLEDGE_RECORD_RELATION_TYPES)[number];

export const knowledgeRecordRelationTypeSchema = z.enum(
  KNOWLEDGE_RECORD_RELATION_TYPES,
);

/** One logical edge; persist with from_record_id < to_record_id. */
export const SYMMETRIC_KNOWLEDGE_RECORD_RELATION_TYPES = [
  'relates_to',
  'contradicts',
] as const;

/** Directed types that reject cycles on write. */
export const CYCLE_CHECKED_KNOWLEDGE_RECORD_RELATION_TYPES = [
  'depends_on',
  'refines',
] as const;

export const KNOWLEDGE_RECORD_RELATION_INVERSE = {
  relates_to: 'relates_to',
  depends_on: 'required_by',
  refines: 'refined_by',
  derived_from: 'source_for',
  contradicts: 'contradicts',
} as const;

export type KnowledgeRecordRelationInverse =
  (typeof KNOWLEDGE_RECORD_RELATION_INVERSE)[KnowledgeRecordRelationType];

export const MAX_KNOWLEDGE_RECORD_RELATIONS = 200;

/** Compact `recordRelations.items` cap on get_knowledge_record. */
export const RECORD_RELATIONS_COMPACT_CAP = 20;

export type StoredRelationEdge = {
  fromId: string;
  toId: string;
  relationType: KnowledgeRecordRelationType;
};

export function isSymmetricKnowledgeRecordRelation(
  relationType: KnowledgeRecordRelationType,
): boolean {
  return (
    relationType === 'relates_to' || relationType === 'contradicts'
  );
}

export function isCycleCheckedKnowledgeRecordRelation(
  relationType: KnowledgeRecordRelationType,
): boolean {
  return relationType === 'depends_on' || relationType === 'refines';
}

export function inverseKnowledgeRecordRelation(
  relationType: KnowledgeRecordRelationType,
): KnowledgeRecordRelationInverse {
  return KNOWLEDGE_RECORD_RELATION_INVERSE[relationType];
}

/** UUID text order, case-insensitive, keeping the original id strings. */
export function canonicalRecordPair(
  left: string,
  right: string,
): [string, string] {
  return left.toLowerCase() < right.toLowerCase()
    ? [left, right]
    : [right, left];
}

export function normalizeStoredRelation(input: {
  anchorId: string;
  targetId: string;
  relationType: KnowledgeRecordRelationType;
}): StoredRelationEdge {
  if (input.anchorId.toLowerCase() === input.targetId.toLowerCase()) {
    throw new AppError({
      code: 'RELATION_SELF_LINK',
      message: 'A record cannot relate to itself',
      statusCode: 400,
    });
  }
  if (isSymmetricKnowledgeRecordRelation(input.relationType)) {
    const [fromId, toId] = canonicalRecordPair(input.anchorId, input.targetId);
    return { fromId, toId, relationType: input.relationType };
  }
  return {
    fromId: input.anchorId,
    toId: input.targetId,
    relationType: input.relationType,
  };
}

export function relationEdgeKey(edge: StoredRelationEdge): string {
  return `${edge.relationType}|${edge.fromId}|${edge.toId}`;
}

/**
 * Directed edges are owned by the record stored as `from`.
 * Symmetric edges are stored once (lower uuid first) but either endpoint
 * may add or remove them.
 */
export function anchorOwnsStoredRelation(
  anchorId: string,
  edge: StoredRelationEdge,
): boolean {
  if (edge.fromId === anchorId) return true;
  return (
    isSymmetricKnowledgeRecordRelation(edge.relationType)
    && edge.toId === anchorId
  );
}

/**
 * Where a touching edge appears for this record.
 * Symmetric types are outbound on both endpoints, independent of uuid order.
 * Directed inbound edges stay inbound.
 */
export function relationListDirection(
  anchorId: string,
  edge: StoredRelationEdge,
): 'outbound' | 'inbound' | null {
  if (edge.fromId !== anchorId && edge.toId !== anchorId) return null;
  if (
    isSymmetricKnowledgeRecordRelation(edge.relationType)
    || edge.fromId === anchorId
  ) {
    return 'outbound';
  }
  return 'inbound';
}

/**
 * Replace the edges this anchor owns. Directed inbound edges stay.
 * Symmetric edges are owned by both endpoints.
 */
export function relationReplacePlan(input: {
  anchorId: string;
  existing: StoredRelationEdge[];
  desired: StoredRelationEdge[];
}): {
  deleteEdges: StoredRelationEdge[];
  insertEdges: StoredRelationEdge[];
} {
  const desiredKeys = new Set(input.desired.map(relationEdgeKey));
  const existingKeys = new Set(input.existing.map(relationEdgeKey));
  const deleteEdges = input.existing.filter(
    (edge) =>
      anchorOwnsStoredRelation(input.anchorId, edge)
      && !desiredKeys.has(relationEdgeKey(edge)),
  );
  const insertEdges = input.desired.filter(
    (edge) => !existingKeys.has(relationEdgeKey(edge)),
  );
  return { deleteEdges, insertEdges };
}

/**
 * Workspace graph for one stored type after replacing edges this anchor owns.
 * Directed types own every row whose from id is the anchor.
 */
export function graphAfterRelationReplace(input: {
  anchorId: string;
  relationType: KnowledgeRecordRelationType;
  existing: StoredRelationEdge[];
  desired: StoredRelationEdge[];
}): StoredRelationEdge[] {
  const desiredOfType = input.desired.filter(
    (edge) => edge.relationType === input.relationType,
  );
  const kept = input.existing.filter(
    (edge) =>
      edge.relationType === input.relationType
      && edge.fromId !== input.anchorId,
  );
  const merged = new Map<string, StoredRelationEdge>();
  for (const edge of [...kept, ...desiredOfType]) {
    merged.set(relationEdgeKey(edge), edge);
  }
  return [...merged.values()];
}

/**
 * First directed cycle in edges from → to, including both ends.
 * Null when the graph is acyclic.
 */
export function relationCyclePath(
  edges: Array<{ fromId: string; toId: string }>,
): string[] | null {
  const outgoing = new Map<string, string[]>();
  const nodes = new Set<string>();
  for (const edge of edges) {
    nodes.add(edge.fromId);
    nodes.add(edge.toId);
    const next = outgoing.get(edge.fromId) ?? [];
    next.push(edge.toId);
    outgoing.set(edge.fromId, next);
  }

  const color = new Map<string, 0 | 1 | 2>();
  const parent = new Map<string, string | null>();

  const walk = (node: string): string[] | null => {
    color.set(node, 1);
    for (const next of outgoing.get(node) ?? []) {
      const state = color.get(next) ?? 0;
      if (state === 1) {
        const path = [next, node];
        let cursor = node;
        while (cursor !== next) {
          const prior = parent.get(cursor);
          if (!prior) break;
          path.push(prior);
          cursor = prior;
          if (path.length > nodes.size + 2) break;
        }
        return path.reverse();
      }
      if (state === 0) {
        parent.set(next, node);
        const found = walk(next);
        if (found) return found;
      }
    }
    color.set(node, 2);
    return null;
  };

  for (const node of nodes) {
    if ((color.get(node) ?? 0) !== 0) continue;
    parent.set(node, null);
    const found = walk(node);
    if (found) return found;
  }
  return null;
}
