import { describe, expect, it, vi } from 'vitest';
import { sortWorkspacesByName } from './workspace-sort';

const createdOrder = [
  'Telkikk',
  'bootdave',
  'MK Design Agentur',
  'AMAE',
  'FecoBootmaker',
  'Homelab Workspace',
  'Bootmaker Kft',
];

const alphabetical = [
  'AMAE',
  'bootdave',
  'Bootmaker Kft',
  'FecoBootmaker',
  'Homelab Workspace',
  'MK Design Agentur',
  'Telkikk',
];

describe('sortWorkspacesByName', () => {
  it('sorts the rail switcher by display name for en, hu, and de', () => {
    const workspaces = createdOrder.map((name, index) => ({
      id: String(index),
      name,
    }));
    for (const locale of ['en', 'hu', 'de']) {
      expect(sortWorkspacesByName(workspaces, locale).map((row) => row.name)).toEqual(
        alphabetical,
      );
    }
    expect(workspaces.map((row) => row.name)).toEqual(createdOrder);
  });

  it('uses a base-sensitivity collator for the UI locale and keeps case ties stable', () => {
    const spy = vi.spyOn(Intl, 'Collator');
    const rows = [{ name: 'Bootmaker' }, { name: 'bootmaker' }];
    expect(sortWorkspacesByName(rows, 'hu').map((row) => row.name)).toEqual([
      'Bootmaker',
      'bootmaker',
    ]);
    expect(spy).toHaveBeenCalledWith('hu', { sensitivity: 'base' });
    spy.mockRestore();
  });
});
