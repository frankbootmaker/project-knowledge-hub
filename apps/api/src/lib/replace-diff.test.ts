import { describe, expect, it } from 'vitest';
import { diffReplacement } from './replace-diff.js';

type Existing = { id: string; key: string; role: string; createdBy: string };
type Next = { key: string; role: string };

function diff(existing: Existing[], next: Next[]) {
  return diffReplacement(
    existing,
    next,
    (row) => row.key,
    (row) => row.key,
    (prev, row) => prev.role === row.role,
  );
}

describe('diffReplacement', () => {
  const human = {
    id: 'row-1',
    key: 'human',
    role: 'R',
    createdBy: 'human-user',
  };
  const system = {
    id: 'row-2',
    key: 'system',
    role: 'A',
    createdBy: 'system-user',
  };

  it('keeps unchanged rows, inserts new keys, and deletes removed keys', () => {
    const result = diff(
      [human, system],
      [
        { key: 'human', role: 'R' },
        { key: 'new', role: 'C' },
      ],
    );

    expect(result.keep).toEqual([human]);
    expect(result.insert).toEqual([{ key: 'new', role: 'C' }]);
    expect(result.remove).toEqual([system]);
    expect(result.update).toEqual([]);
  });

  it('updates a changed payload without treating the row as new', () => {
    const result = diff([human], [{ key: 'human', role: 'A' }]);
    expect(result.keep).toEqual([]);
    expect(result.insert).toEqual([]);
    expect(result.remove).toEqual([]);
    expect(result.update).toEqual([
      { existing: human, next: { key: 'human', role: 'A' } },
    ]);
  });

  it('ignores duplicate next keys and drops every existing row when next is empty', () => {
    const result = diff(
      [human],
      [
        { key: 'human', role: 'R' },
        { key: 'human', role: 'C' },
      ],
    );
    expect(result.keep).toEqual([human]);
    expect(result.insert).toEqual([]);

    const cleared = diff([human, system], []);
    expect(cleared.remove).toEqual([human, system]);
    expect(cleared.keep).toEqual([]);
    expect(cleared.insert).toEqual([]);
  });
});
