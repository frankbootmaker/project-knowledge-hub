import { describe, expect, it } from 'vitest';
import { AppError } from './index.js';
import {
  canonicalRecordPair,
  graphAfterRelationReplace,
  inverseKnowledgeRecordRelation,
  knowledgeRecordRelationTypeSchema,
  normalizeStoredRelation,
  relationCyclePath,
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
