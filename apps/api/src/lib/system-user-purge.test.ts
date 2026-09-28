import { describe, expect, it } from 'vitest';
import { AppError } from '@project-knowledge-hub/domain';
import {
  assertPurgeProject,
  assertPurgeTargetUser,
  planSystemUserPurge,
  purgeCommitDecision,
  type SystemUserPurgeSnapshot,
} from './system-user-purge.js';

const SYS = 'system-user';
const HUMAN = 'human-user';
const PROJECT = 'project-1';
const OTHER = 'project-2';
const WS = 'workspace-1';
const ORG = 'org-1';

function snapshot(
  overrides: Partial<SystemUserPurgeSnapshot> = {},
): SystemUserPurgeSnapshot {
  return {
    systemUserId: SYS,
    projectId: PROJECT,
    workspaceId: WS,
    organizationId: ORG,
    tasks: [],
    sprints: [],
    epics: [],
    userStories: [],
    milestones: [],
    raidItems: [],
    changeItems: [],
    activities: [],
    raci: [],
    stakeholders: [],
    knowledgeDeliveryLinks: [],
    changeDeliveryLinks: [],
    raidTaskLinks: [],
    knowledgeRecords: [],
    knowledgeRecordVersions: [],
    media: [],
    systems: [],
    tags: [],
    tagLinks: [],
    mediaImportRefs: [],
    recordImportRefs: [],
    ...overrides,
  };
}

describe('system user purge guards', () => {
  it('refuses a missing user and a human user', () => {
    expect(() => assertPurgeTargetUser(null)).toThrow(AppError);
    try {
      assertPurgeTargetUser(null);
    } catch (error) {
      expect(error).toMatchObject({ code: 'USER_NOT_FOUND', statusCode: 404 });
    }
    try {
      assertPurgeTargetUser({ id: HUMAN, userType: 'human' });
      throw new Error('expected human refusal');
    } catch (error) {
      expect(error).toMatchObject({
        code: 'PURGE_TARGET_NOT_SYSTEM',
        statusCode: 409,
      });
    }
  });

  it('accepts a system user and refuses a missing project', () => {
    expect(() =>
      assertPurgeTargetUser({ id: SYS, userType: 'system' }),
    ).not.toThrow();
    expect(() => assertPurgeProject(null)).toThrow(AppError);
    try {
      assertPurgeProject(null);
    } catch (error) {
      expect(error).toMatchObject({
        code: 'PROJECT_NOT_FOUND',
        statusCode: 404,
      });
    }
    expect(() => assertPurgeProject({ id: PROJECT })).not.toThrow();
  });

  it('dry-run and conflicts do not commit; a clean plan does', () => {
    expect(purgeCommitDecision({ dryRun: true, conflictCount: 0 })).toBe(
      'dry_run',
    );
    expect(purgeCommitDecision({ dryRun: true, conflictCount: 2 })).toBe(
      'dry_run',
    );
    expect(purgeCommitDecision({ dryRun: false, conflictCount: 2 })).toBe(
      'refuse_conflicts',
    );
    expect(purgeCommitDecision({ dryRun: false, conflictCount: 0 })).toBe(
      'commit',
    );
  });
});

describe('planSystemUserPurge', () => {
  it('deletes only the system user rows in the target project', () => {
    const plan = planSystemUserPurge(
      snapshot({
        tasks: [
          {
            id: 'qa-task',
            createdBy: SYS,
            projectId: PROJECT,
            milestoneId: null,
            userStoryId: null,
            sprintId: null,
            aiSystemId: null,
          },
          {
            id: 'human-task',
            createdBy: HUMAN,
            projectId: PROJECT,
            milestoneId: null,
            userStoryId: null,
            sprintId: null,
            aiSystemId: null,
          },
          {
            id: 'other-project-task',
            createdBy: SYS,
            projectId: OTHER,
            milestoneId: null,
            userStoryId: null,
            sprintId: null,
            aiSystemId: null,
          },
        ],
        sprints: [
          { id: 'qa-sprint', createdBy: SYS, projectId: PROJECT },
          { id: 'human-sprint', createdBy: HUMAN, projectId: PROJECT },
        ],
        epics: [{ id: 'qa-epic', createdBy: SYS, projectId: PROJECT }],
        userStories: [
          {
            id: 'qa-story',
            createdBy: SYS,
            projectId: PROJECT,
            epicId: 'qa-epic',
          },
        ],
        milestones: [
          { id: 'qa-milestone', createdBy: SYS, projectId: PROJECT },
        ],
        raidItems: [
          {
            id: 'qa-raid',
            createdBy: SYS,
            projectId: PROJECT,
            transferredToRaidItemId: null,
            transferredFromRaidItemId: null,
          },
        ],
        changeItems: [
          {
            id: 'qa-change',
            createdBy: SYS,
            projectId: PROJECT,
            knowledgeRecordId: null,
          },
        ],
        stakeholders: [
          { id: 'qa-stakeholder', createdBy: SYS, projectId: PROJECT },
          { id: 'human-stakeholder', createdBy: HUMAN, projectId: PROJECT },
        ],
        activities: [
          {
            id: 'qa-comment',
            actorUserId: SYS,
            taskId: 'human-task',
            type: 'comment',
            fields: [],
          },
          {
            id: 'qa-ai',
            actorUserId: SYS,
            taskId: 'human-task',
            type: 'fields_updated',
            fields: ['tokensUsed'],
          },
          {
            id: 'human-note',
            actorUserId: HUMAN,
            taskId: 'human-task',
            type: 'comment',
            fields: [],
          },
        ],
        raci: [
          { id: 'qa-raci', createdBy: SYS, taskId: 'human-task' },
          { id: 'human-raci', createdBy: HUMAN, taskId: 'human-task' },
        ],
        knowledgeRecords: [
          {
            id: 'qa-record',
            createdBy: SYS,
            projectId: PROJECT,
            workspaceId: WS,
            systemId: null,
            translationGroupId: null,
            supersedesRecordId: null,
          },
          {
            id: 'human-record',
            createdBy: HUMAN,
            projectId: PROJECT,
            workspaceId: WS,
            systemId: null,
            translationGroupId: null,
            supersedesRecordId: null,
          },
        ],
        knowledgeRecordVersions: [
          {
            id: 'qa-version',
            createdBy: SYS,
            knowledgeRecordId: 'qa-record',
          },
        ],
        systems: [
          {
            id: 'qa-system',
            createdBy: SYS,
            workspaceId: WS,
            projectId: PROJECT,
          },
          {
            id: 'workspace-system',
            createdBy: SYS,
            workspaceId: WS,
            projectId: null,
          },
          {
            id: 'other-system',
            createdBy: SYS,
            workspaceId: WS,
            projectId: OTHER,
          },
        ],
        tags: [
          { id: 'qa-tag', createdBy: SYS, organizationId: ORG },
          { id: 'human-tag', createdBy: HUMAN, organizationId: ORG },
        ],
        tagLinks: [
          { tagId: 'qa-tag', ownerType: 'project', ownerId: PROJECT },
        ],
        media: [
          {
            id: 'qa-media',
            createdBy: SYS,
            workspaceId: WS,
            knowledgeRecordId: 'qa-record',
          },
        ],
      }),
    );

    expect(plan.conflicts).toEqual([]);
    expect(purgeCommitDecision({
      dryRun: false,
      conflictCount: plan.conflicts.length,
    })).toBe('commit');
    expect(purgeCommitDecision({
      dryRun: true,
      conflictCount: plan.conflicts.length,
    })).toBe('dry_run');
    expect(plan.counts).toMatchObject({
      tasks: 1,
      sprints: 1,
      epics: 1,
      userStories: 1,
      milestones: 1,
      raidItems: 1,
      changeItems: 1,
      comments: 1,
      activities: 0,
      aiUsageReports: 1,
      raci: 1,
      stakeholders: 1,
      knowledgeRecords: 1,
      knowledgeRecordVersions: 1,
      translations: 0,
      media: 1,
      systems: 2,
      tags: 1,
    });
    expect(plan.deleteIds.tasks).toEqual(['qa-task']);
    expect(plan.deleteIds.tasks).not.toContain('human-task');
    expect(plan.deleteIds.tasks).not.toContain('other-project-task');
    expect(plan.deleteIds.sprints).toEqual(['qa-sprint']);
    expect(plan.deleteIds.stakeholders).toEqual(['qa-stakeholder']);
    expect(plan.deleteIds.comments).toEqual(['qa-comment']);
    expect(plan.deleteIds.aiUsageReports).toEqual(['qa-ai']);
    expect(plan.deleteIds.raci).toEqual(['qa-raci']);
    expect(plan.deleteIds.knowledgeRecords).toEqual(['qa-record']);
    expect(plan.deleteIds.systems).toEqual(['qa-system', 'workspace-system']);
    expect(plan.deleteIds.tags).toEqual(['qa-tag']);
    expect(plan.detaches).toContainEqual({
      entityType: 'tag_link',
      entityId: PROJECT,
      field: 'tagId',
      tagId: 'qa-tag',
      ownerType: 'project',
    });
  });

  it('detaches a human task from a system sprint and still deletes the sprint', () => {
    const plan = planSystemUserPurge(
      snapshot({
        tasks: [
          {
            id: 'human-task',
            createdBy: HUMAN,
            projectId: PROJECT,
            milestoneId: 'qa-milestone',
            userStoryId: null,
            sprintId: 'qa-sprint',
            aiSystemId: 'qa-system',
          },
        ],
        sprints: [{ id: 'qa-sprint', createdBy: SYS, projectId: PROJECT }],
        milestones: [
          { id: 'qa-milestone', createdBy: SYS, projectId: PROJECT },
        ],
        systems: [
          {
            id: 'qa-system',
            createdBy: SYS,
            workspaceId: WS,
            projectId: PROJECT,
          },
        ],
      }),
    );

    expect(plan.conflicts).toEqual([]);
    expect(plan.deleteIds.tasks).toEqual([]);
    expect(plan.deleteIds.sprints).toEqual(['qa-sprint']);
    expect(plan.deleteIds.milestones).toEqual(['qa-milestone']);
    expect(plan.deleteIds.systems).toEqual(['qa-system']);
    expect(plan.detaches).toEqual(
      expect.arrayContaining([
        { entityType: 'task', entityId: 'human-task', field: 'milestoneId' },
        { entityType: 'task', entityId: 'human-task', field: 'sprintId' },
        { entityType: 'task', entityId: 'human-task', field: 'aiSystemId' },
      ]),
    );
  });

  it('refuses when a human comment or story would be cascade-deleted', () => {
    const plan = planSystemUserPurge(
      snapshot({
        tasks: [
          {
            id: 'qa-task',
            createdBy: SYS,
            projectId: PROJECT,
            milestoneId: null,
            userStoryId: null,
            sprintId: null,
            aiSystemId: null,
          },
        ],
        activities: [
          {
            id: 'human-comment',
            actorUserId: HUMAN,
            taskId: 'qa-task',
            type: 'comment',
            fields: [],
          },
        ],
        epics: [{ id: 'qa-epic', createdBy: SYS, projectId: PROJECT }],
        userStories: [
          {
            id: 'human-story',
            createdBy: HUMAN,
            projectId: PROJECT,
            epicId: 'qa-epic',
          },
        ],
        raci: [{ id: 'unowned-raci', createdBy: null, taskId: 'qa-task' }],
      }),
    );

    expect(plan.counts.tasks).toBe(1);
    expect(plan.counts.epics).toBe(1);
    expect(plan.deleteIds.tasks).toEqual(['qa-task']);
    expect(plan.conflicts.map((conflict) => conflict.entityId).sort()).toEqual([
      'human-comment',
      'human-story',
      'unowned-raci',
    ]);
    expect(
      purgeCommitDecision({
        dryRun: true,
        conflictCount: plan.conflicts.length,
      }),
    ).toBe('dry_run');
    expect(
      purgeCommitDecision({
        dryRun: false,
        conflictCount: plan.conflicts.length,
      }),
    ).toBe('refuse_conflicts');
  });

  it('deletes a system delivery link without deleting the human endpoints', () => {
    const plan = planSystemUserPurge(
      snapshot({
        knowledgeRecords: [
          {
            id: 'human-record',
            createdBy: HUMAN,
            projectId: PROJECT,
            workspaceId: WS,
            systemId: 'qa-system',
            translationGroupId: 'group-1',
            supersedesRecordId: null,
          },
          {
            id: 'qa-translation',
            createdBy: SYS,
            projectId: PROJECT,
            workspaceId: WS,
            systemId: null,
            translationGroupId: 'group-1',
            supersedesRecordId: null,
          },
        ],
        knowledgeRecordVersions: [
          {
            id: 'translation-version',
            createdBy: SYS,
            knowledgeRecordId: 'qa-translation',
          },
        ],
        knowledgeDeliveryLinks: [
          {
            id: 'qa-link',
            createdBy: SYS,
            knowledgeRecordId: 'human-record',
          },
          {
            id: 'human-link',
            createdBy: HUMAN,
            knowledgeRecordId: 'qa-translation',
          },
        ],
        systems: [
          {
            id: 'qa-system',
            createdBy: SYS,
            workspaceId: WS,
            projectId: null,
          },
        ],
      }),
    );

    expect(plan.conflicts.map((conflict) => conflict.entityId)).toEqual([
      'human-link',
    ]);
    expect(plan.deleteIds.knowledgeDeliveryLinks).toEqual(['qa-link']);
    expect(plan.deleteIds.knowledgeRecords).toEqual(['qa-translation']);
    expect(plan.counts.translations).toBe(1);
    expect(plan.counts.knowledgeRecords).toBe(0);
    expect(plan.detaches).toEqual(
      expect.arrayContaining([
        {
          entityType: 'knowledge_record',
          entityId: 'human-record',
          field: 'systemId',
        },
        {
          entityType: 'knowledge_record',
          entityId: 'human-record',
          field: 'translationGroupId',
        },
      ]),
    );
  });

  it('refuses a record linked from a human conversation import', () => {
    const plan = planSystemUserPurge(
      snapshot({
        knowledgeRecords: [
          {
            id: 'qa-record',
            createdBy: SYS,
            projectId: PROJECT,
            workspaceId: WS,
            systemId: null,
            translationGroupId: null,
            supersedesRecordId: null,
          },
        ],
        knowledgeRecordVersions: [
          { id: 'v1', createdBy: SYS, knowledgeRecordId: 'qa-record' },
        ],
        recordImportRefs: [
          {
            knowledgeRecordId: 'qa-record',
            importCreatedBy: HUMAN,
            kind: 'conversation_import',
          },
        ],
      }),
    );
    expect(plan.conflicts).toEqual([
      {
        entityType: 'conversation_import',
        entityId: 'qa-record',
        reason:
          'An import the system user did not create links this record. Deleting the record would remove that link.',
      },
    ]);
    expect(
      purgeCommitDecision({
        dryRun: false,
        conflictCount: plan.conflicts.length,
      }),
    ).toBe('refuse_conflicts');
  });

  it('refuses media that a kept record or a human import still uses', () => {
    const plan = planSystemUserPurge(
      snapshot({
        knowledgeRecords: [
          {
            id: 'human-record',
            createdBy: HUMAN,
            projectId: PROJECT,
            workspaceId: WS,
            systemId: null,
            translationGroupId: null,
            supersedesRecordId: null,
          },
        ],
        media: [
          {
            id: 'linked-media',
            createdBy: SYS,
            workspaceId: WS,
            knowledgeRecordId: 'human-record',
          },
          {
            id: 'import-media',
            createdBy: SYS,
            workspaceId: WS,
            knowledgeRecordId: null,
          },
        ],
        mediaImportRefs: [
          { mediaId: 'import-media', importCreatedBy: HUMAN },
        ],
      }),
    );

    expect(plan.deleteIds.media).toEqual([]);
    expect(plan.conflicts.map((conflict) => conflict.entityId).sort()).toEqual([
      'import-media',
      'linked-media',
    ]);
  });
});
