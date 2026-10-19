import { describe, expect, it } from 'vitest';
import { AppError } from './index.js';
import {
  canonicalRecordPair,
  graphAfterRelationReplace,
  inverseKnowledgeRecordRelation,
  knowledgeRecordRelationTypeSchema,
  normalizeStoredRelation,
  relationCyclePath,
  relationListDirection,
  relationReplacePlan,
  type StoredRelationEdge,
} from './knowledge-record-relations.js';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

describe('knowledge record relation types', () => {
  it('accepts the v1 catalog and rejects inverse names as stored types', () => {
    expect(knowledgeRecordRelationTypeSchema.parse('depends_on')).toBe(
      'depends_on',
    );
    expect(knowledgeRecordRelationTypeSchema.safeParse('required_by').success)
      .toBe(false);
    expect(knowledgeRecordRelationTypeSchema.safeParse('supersedes').success)
      .toBe(false);
  });

  it('labels directed inverses and keeps symmetric types unchanged', () => {
    expect(inverseKnowledgeRecordRelation('depends_on')).toBe('required_by');
    expect(inverseKnowledgeRecordRelation('refines')).toBe('refined_by');
    expect(inverseKnowledgeRecordRelation('derived_from')).toBe('source_for');
    expect(inverseKnowledgeRecordRelation('relates_to')).toBe('relates_to');
    expect(inverseKnowledgeRecordRelation('contradicts')).toBe('contradicts');
  });
});

describe('symmetric canonical ordering', () => {
  it('stores the smaller uuid as from', () => {
    expect(canonicalRecordPair(B, A)).toEqual([A, B]);
    const fromB = normalizeStoredRelation({
      anchorId: B,
      targetId: A,
      relationType: 'relates_to',
    });
    const fromA = normalizeStoredRelation({
      anchorId: A,
      targetId: B,
      relationType: 'contradicts',
    });
    expect(fromB).toEqual({
      fromId: A,
      toId: B,
      relationType: 'relates_to',
    });
    expect(fromA.fromId).toBe(A);
    expect(fromA.toId).toBe(B);
  });

  it('keeps directed edges in the writer’s direction', () => {
    expect(
      normalizeStoredRelation({
        anchorId: B,
        targetId: A,
        relationType: 'depends_on',
      }),
    ).toEqual({ fromId: B, toId: A, relationType: 'depends_on' });
  });

  it('rejects a self link', () => {
    expect(() =>
      normalizeStoredRelation({
        anchorId: A,
        targetId: A.toUpperCase(),
        relationType: 'derived_from',
      }),
    ).toThrow(AppError);
  });
});

describe('relation replace plan', () => {
  const existing: StoredRelationEdge[] = [
    { fromId: A, toId: B, relationType: 'depends_on' },
    { fromId: C, toId: A, relationType: 'refines' },
    { fromId: A, toId: B, relationType: 'relates_to' },
  ];

  it('replaces only edges stored from the anchor', () => {
    const desired: StoredRelationEdge[] = [
      { fromId: A, toId: C, relationType: 'depends_on' },
    ];
    const plan = relationReplacePlan({
      anchorId: A,
      existing,
      desired,
    });
    expect(plan.deleteEdges).toEqual([
      { fromId: A, toId: B, relationType: 'depends_on' },
      { fromId: A, toId: B, relationType: 'relates_to' },
    ]);
    expect(plan.insertEdges).toEqual(desired);
  });

  it('does not delete an inbound edge when the anchor omits it', () => {
    const plan = relationReplacePlan({
      anchorId: A,
      existing,
      desired: [],
    });
    expect(plan.deleteEdges.map((edge) => edge.relationType)).toEqual([
      'depends_on',
      'relates_to',
    ]);
    expect(
      plan.deleteEdges.some((edge) => edge.relationType === 'refines'),
    ).toBe(false);
  });

  it('removes a symmetric edge from the higher uuid and keeps directed inbound', () => {
    const stored: StoredRelationEdge[] = [
      { fromId: A, toId: B, relationType: 'relates_to' },
      { fromId: A, toId: B, relationType: 'contradicts' },
      { fromId: C, toId: B, relationType: 'depends_on' },
    ];
    const cleared = relationReplacePlan({
      anchorId: B,
      existing: stored,
      desired: [],
    });
    expect(cleared.deleteEdges).toEqual([
      { fromId: A, toId: B, relationType: 'relates_to' },
      { fromId: A, toId: B, relationType: 'contradicts' },
    ]);

    const kept = relationReplacePlan({
      anchorId: B,
      existing: stored,
      desired: [{ fromId: A, toId: B, relationType: 'relates_to' }],
    });
    expect(kept.deleteEdges).toEqual([
      { fromId: A, toId: B, relationType: 'contradicts' },
    ]);
    expect(kept.insertEdges).toEqual([]);

    const fromLower = relationReplacePlan({
      anchorId: A,
      existing: stored,
      desired: [],
    });
    expect(fromLower.deleteEdges.map((edge) => edge.relationType)).toEqual([
      'relates_to',
      'contradicts',
    ]);
  });
});

describe('relation list direction', () => {
  it('lists symmetric relations as outbound on both uuid orders', () => {
    const edge: StoredRelationEdge = {
      fromId: A,
      toId: B,
      relationType: 'relates_to',
    };
    expect(relationListDirection(A, edge)).toBe('outbound');
    expect(relationListDirection(B, edge)).toBe('outbound');
    expect(relationListDirection(C, edge)).toBeNull();
    expect(
      relationListDirection(B, {
        fromId: A,
        toId: B,
        relationType: 'depends_on',
      }),
    ).toBe('inbound');
    expect(
      relationListDirection(A, {
        fromId: A,
        toId: B,
        relationType: 'derived_from',
      }),
    ).toBe('outbound');
  });
});

describe('relation cycles', () => {
  it('rejects a two-node depends_on cycle and a longer refines cycle', () => {
    const two = graphAfterRelationReplace({
      anchorId: B,
      relationType: 'depends_on',
      existing: [{ fromId: A, toId: B, relationType: 'depends_on' }],
      desired: [{ fromId: B, toId: A, relationType: 'depends_on' }],
    });
    expect(relationCyclePath(two)).toEqual([A, B, A]);

    const longer = graphAfterRelationReplace({
      anchorId: C,
      relationType: 'refines',
      existing: [
        { fromId: A, toId: B, relationType: 'refines' },
        { fromId: B, toId: C, relationType: 'refines' },
      ],
      desired: [{ fromId: C, toId: A, relationType: 'refines' }],
    });
    expect(relationCyclePath(longer)).toEqual([A, B, C, A]);
  });

  it('checks depends_on and refines as separate graphs', () => {
    const dependsOn = graphAfterRelationReplace({
      anchorId: B,
      relationType: 'depends_on',
      existing: [
        { fromId: A, toId: B, relationType: 'refines' },
        { fromId: A, toId: B, relationType: 'depends_on' },
      ],
      desired: [{ fromId: B, toId: A, relationType: 'depends_on' }],
    });
    expect(dependsOn.every((edge) => edge.relationType === 'depends_on')).toBe(
      true,
    );
    expect(relationCyclePath(dependsOn)).toEqual([A, B, A]);

    const refines = graphAfterRelationReplace({
      anchorId: B,
      relationType: 'refines',
      existing: [{ fromId: A, toId: B, relationType: 'refines' }],
      desired: [{ fromId: B, toId: C, relationType: 'refines' }],
    });
    expect(relationCyclePath(refines)).toBeNull();
  });

  it('reports a mutual pair and a one-way edge', () => {
    expect(
      relationCyclePath([
        { fromId: A, toId: B },
        { fromId: B, toId: A },
      ]),
    ).toEqual([A, B, A]);
    expect(relationCyclePath([{ fromId: A, toId: B }])).toBeNull();
  });
});
