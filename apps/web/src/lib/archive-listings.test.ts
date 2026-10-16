import { describe, expect, it } from 'vitest';
import {
  knowledgeRecordAppearsInArchive,
  projectAppearsInArchive,
  systemAppearsInArchive,
} from './archive-listings';

describe('archive listing membership', () => {
  it('keeps a live project out of the archive', () => {
    expect(projectAppearsInArchive({ archivedAt: null, status: 'active' })).toBe(false);
  });

  it('lists a project when it is soft-deleted or its status is archived', () => {
    expect(projectAppearsInArchive({ archivedAt: '2026-10-16', status: 'active' })).toBe(true);
    expect(projectAppearsInArchive({ archivedAt: null, status: 'archived' })).toBe(true);
  });

  it('lists a system when it is soft-deleted or its status is archived', () => {
    expect(systemAppearsInArchive({ archivedAt: null, status: 'active' })).toBe(false);
    expect(systemAppearsInArchive({ archivedAt: '2026-10-16', status: 'active' })).toBe(true);
    expect(systemAppearsInArchive({ archivedAt: null, status: 'archived' })).toBe(true);
  });

  it('lists a knowledge record when it is soft-deleted or its lifecycle is archived', () => {
    expect(
      knowledgeRecordAppearsInArchive({ archivedAt: null, lifecycleStatus: 'current' }),
    ).toBe(false);
    expect(
      knowledgeRecordAppearsInArchive({ archivedAt: '2026-10-16', lifecycleStatus: 'current' }),
    ).toBe(true);
    expect(
      knowledgeRecordAppearsInArchive({ archivedAt: null, lifecycleStatus: 'archived' }),
    ).toBe(true);
  });
});
