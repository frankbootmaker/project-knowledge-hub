import { describe, expect, it } from 'vitest';
import {
  archivedParentLinkTarget,
  milestoneLinkChangeBlocked,
} from './archived-parent-link';

describe('archived parent links', () => {
  const parents = [
    { id: 'open', title: 'Open', archivedAt: null, humanKey: 'PNZ-S-1' },
    { id: 'closed', title: 'Closed', archivedAt: '2026-10-19T06:27:20Z', humanKey: 'PNZ-M-12' },
  ];

  it('blocks a new link to an archived parent and keeps the current one', () => {
    expect(
      archivedParentLinkTarget({ nextId: 'closed', currentId: null, parents }),
    ).toEqual({ id: 'closed', key: 'PNZ-M-12' });
    expect(
      archivedParentLinkTarget({ nextId: 'closed', currentId: 'closed', parents }),
    ).toBeNull();
    expect(
      archivedParentLinkTarget({ nextId: 'open', currentId: null, parents }),
    ).toBeNull();
    expect(
      archivedParentLinkTarget({ nextId: '', currentId: null, parents }),
    ).toBeNull();
  });

  it('blocks only a changed link set on an archived milestone', () => {
    expect(
      milestoneLinkChangeBlocked({
        archivedAt: '2026-10-19T06:27:20Z',
        nextIds: ['task:b', 'task:a'],
        currentIds: ['task:a'],
      }),
    ).toBe(true);
    expect(
      milestoneLinkChangeBlocked({
        archivedAt: '2026-10-19T06:27:20Z',
        nextIds: ['task:b', 'task:a'],
        currentIds: ['task:a', 'task:b'],
      }),
    ).toBe(false);
    expect(
      milestoneLinkChangeBlocked({
        archivedAt: null,
        nextIds: ['task:b'],
        currentIds: [],
      }),
    ).toBe(false);
  });
});
