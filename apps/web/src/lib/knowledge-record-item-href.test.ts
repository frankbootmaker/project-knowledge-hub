import { describe, expect, it } from 'vitest';
import { knowledgeRecordItemHref, linkedItemGroup } from './knowledge-record-item-href';

const base = {
  workspaceSlug: 'platform',
  projectSlug: 'renewal',
};

describe('knowledgeRecordItemHref', () => {
  it('opens RAID on the RAID section', () => {
    expect(
      knowledgeRecordItemHref({
        ...base,
        type: 'raid',
        kind: 'risk',
        id: 'raid-1',
      }),
    ).toBe('/workspaces/platform/projects/renewal?raid=raid-1#project-raid');
  });

  it('opens tasks and bugs with the delivery task link', () => {
    expect(
      knowledgeRecordItemHref({
        ...base,
        type: 'task',
        kind: 'bug',
        id: 'bug 1',
      }),
    ).toBe('/workspaces/platform/projects/renewal?task=bug%201#project-delivery');
  });

  it('opens sprints on the scrum view and other delivery items on Delivery', () => {
    expect(
      knowledgeRecordItemHref({
        ...base,
        type: 'sprint',
        kind: null,
        id: 'sprint-1',
      }),
    ).toBe('/workspaces/platform/projects/renewal?delivery=scrum#project-delivery');
    expect(
      knowledgeRecordItemHref({
        ...base,
        type: 'epic',
        kind: null,
        id: 'epic-1',
      }),
    ).toBe('/workspaces/platform/projects/renewal#project-delivery');
  });

  it('opens change items on the change section', () => {
    expect(
      knowledgeRecordItemHref({
        ...base,
        type: 'change',
        kind: 'scope',
        id: 'change-1',
      }),
    ).toBe('/workspaces/platform/projects/renewal#project-change');
  });
});

describe('linkedItemGroup', () => {
  it('groups bugs apart from tasks', () => {
    expect(linkedItemGroup({ type: 'task', kind: 'bug' })).toBe('bug');
    expect(linkedItemGroup({ type: 'task', kind: 'task' })).toBe('task');
    expect(linkedItemGroup({ type: 'raid', kind: 'risk' })).toBe('raid');
  });
});
