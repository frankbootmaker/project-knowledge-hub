import { describe, expect, it } from 'vitest';
import { countRelatedEntries } from './KnowledgeRecordRelationsPanel';

describe('countRelatedEntries', () => {
  it('returns zero for null payload', () => {
    expect(countRelatedEntries(null)).toBe(0);
  });

  it('sums outbound and inbound edges', () => {
    expect(
      countRelatedEntries({
        relations: {
          outbound: [
            {
              relationType: 'relates_to',
              record: {
                id: 'a',
                humanKey: null,
                title: 'A',
                slug: 'a',
                recordType: 'note',
                lifecycleStatus: 'draft',
                archivedAt: null,
              },
            },
          ],
          inbound: [
            {
              relationType: 'derived_from',
              record: {
                id: 'b',
                humanKey: null,
                title: 'B',
                slug: 'b',
                recordType: 'note',
                lifecycleStatus: 'draft',
                archivedAt: null,
              },
            },
          ],
        },
        lifecycleSuccessor: null,
        lifecyclePredecessor: null,
      }),
    ).toBe(2);
  });
});
