import { describe, expect, it } from 'vitest';
import { formatWorkspacePurgeMessage, type WorkspacePurgeBlocker } from './workspace-purge.js';

function blocker(overrides: Partial<WorkspacePurgeBlocker> = {}): WorkspacePurgeBlocker {
  return {
    kind: 'item_media',
    count: 20,
    itemKey: 'MIL-T-53',
    itemTitle: 'Screenshots',
    entityType: 'task',
    entityId: '00000000-0000-4000-8000-000000000001',
    workspaceId: '00000000-0000-4000-8000-000000000002',
    workspaceName: 'MileGuide',
    ...overrides,
  };
}

describe('formatWorkspacePurgeMessage', () => {
  it('names the item key and the workspace that still uses the files', () => {
    expect(formatWorkspacePurgeMessage([blocker()])).toBe(
      '20 media files used by MIL-T-53 in workspace MileGuide',
    );
    expect(formatWorkspacePurgeMessage([blocker({ count: 1 })])).toBe(
      '1 media file used by MIL-T-53 in workspace MileGuide',
    );
  });

  it('falls back to the title when the item has no human key', () => {
    expect(
      formatWorkspacePurgeMessage([
        blocker({ itemKey: null, itemTitle: 'Loose task', count: 2 }),
        blocker({
          itemKey: 'MIL-E-1',
          workspaceName: 'Other',
          count: 1,
          entityId: '00000000-0000-4000-8000-000000000003',
        }),
      ]),
    ).toBe(
      '2 media files used by Loose task in workspace MileGuide; 1 media file used by MIL-E-1 in workspace Other',
    );
  });
});
