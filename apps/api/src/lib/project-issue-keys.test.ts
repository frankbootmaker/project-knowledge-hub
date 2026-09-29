import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { loadEnv } from '@project-knowledge-hub/config';
import {
  createDatabase,
  type Database,
  organizations,
  workspaces,
  projects,
  knowledgeRecords,
  projectTasks,
  projectRaidItems,
  eq,
} from '@project-knowledge-hub/database';
import {
  resolveEntityId,
  resolveKnowledgeRecordId,
  allocateIssueNumber,
} from './project-issue-keys.js';

const hasTestDb = Boolean(process.env.DATABASE_URL);

function testEnv() {
  return loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    APP_ENV: 'test',
    LOG_LEVEL: 'silent',
  });
}

describe.skipIf(!hasTestDb)('PRO-T-3: Key prefix resolution scoping', () => {
  let database: Database;
  let closeDatabase: () => Promise<void>;
  let orgId: string;
  let workspace1Id: string;
  let workspace2Id: string;
  let project1Id: string; // CSA in workspace1
  let project2Id: string; // CSA in workspace2
  let _project3Id: string; // PNZ in workspace1
  let record1Id: string; // CSA-CONV-1 in project1
  let record2Id: string; // CSA-CONV-1 in project2
  let task1Id: string; // CSA-T-1 in project1
  let task2Id: string; // CSA-T-1 in project2
  let raid1Id: string; // CSA-RR-1 in project1
  let raid2Id: string; // CSA-RR-1 in project2

  beforeEach(async () => {
    const env = testEnv();
    database = createDatabase(env.DATABASE_URL);
    closeDatabase = () => database.close();

    // Create org
    const suffix = randomUUID().slice(0, 8);
    const [org] = await database.db
      .insert(organizations)
      .values({ name: `Test Org ${suffix}`, slug: `test-org-${suffix}` })
      .returning();
    orgId = org!.id;

    // Create two workspaces
    const [ws1, ws2] = await database.db
      .insert(workspaces)
      .values([
        {
          organizationId: orgId,
          name: `Workspace 1 ${suffix}`,
          slug: `ws1-${suffix}`,
        },
        {
          organizationId: orgId,
          name: `Workspace 2 ${suffix}`,
          slug: `ws2-${suffix}`,
        },
      ])
      .returning();
    workspace1Id = ws1!.id;
    workspace2Id = ws2!.id;

    // Create projects with duplicate prefix CSA in different workspaces
    const [p1, p2, _p3] = await database.db
      .insert(projects)
      .values([
        {
          workspaceId: workspace1Id,
          name: 'Családfa',
          slug: 'csaladfa-1',
          keyPrefix: 'CSA',
        },
        {
          workspaceId: workspace2Id,
          name: 'Családfa',
          slug: 'csaladfa-2',
          keyPrefix: 'CSA',
        },
        {
          workspaceId: workspace1Id,
          name: 'Penzugy',
          slug: 'penzugy',
          keyPrefix: 'PNZ',
        },
      ])
      .returning();
    project1Id = p1!.id;
    project2Id = p2!.id;
    _project3Id = _p3!.id;

    // Allocate keys and create entities with same human keys in different projects
    const key1 = await allocateIssueNumber(database, project1Id, 'CONV');
    const key2 = await allocateIssueNumber(database, project2Id, 'CONV');
    const taskKey1 = await allocateIssueNumber(database, project1Id, 'T');
    const taskKey2 = await allocateIssueNumber(database, project2Id, 'T');
    const raidKey1 = await allocateIssueNumber(database, project1Id, 'RR');
    const raidKey2 = await allocateIssueNumber(database, project2Id, 'RR');

    // Create knowledge records
    const [rec1, rec2] = await database.db
      .insert(knowledgeRecords)
      .values([
        {
          workspaceId: workspace1Id,
          projectId: project1Id,
          title: 'Conversation 1 in WS1',
          slug: 'conv-1-ws1',
          recordType: 'conversation',
          contentMarkdown: 'Content 1',
          documentKeyType: key1.issueKeyType,
          documentNumber: key1.issueNumber,
        },
        {
          workspaceId: workspace2Id,
          projectId: project2Id,
          title: 'Conversation 1 in WS2',
          slug: 'conv-1-ws2',
          recordType: 'conversation',
          contentMarkdown: 'Content 2',
          documentKeyType: key2.issueKeyType,
          documentNumber: key2.issueNumber,
        },
      ])
      .returning();
    record1Id = rec1!.id;
    record2Id = rec2!.id;

    // Create tasks
    const [t1, t2] = await database.db
      .insert(projectTasks)
      .values([
        {
          projectId: project1Id,
          title: 'Task 1 in WS1',
          description: 'Description 1',
          issueKeyType: taskKey1.issueKeyType,
          issueNumber: taskKey1.issueNumber,
        },
        {
          projectId: project2Id,
          title: 'Task 1 in WS2',
          description: 'Description 2',
          issueKeyType: taskKey2.issueKeyType,
          issueNumber: taskKey2.issueNumber,
        },
      ])
      .returning();
    task1Id = t1!.id;
    task2Id = t2!.id;

    // Create RAID items
    const [r1, r2] = await database.db
      .insert(projectRaidItems)
      .values([
        {
          projectId: project1Id,
          kind: 'risk',
          title: 'Risk 1 in WS1',
          description: 'Description 1',
          issueKeyType: raidKey1.issueKeyType,
          issueNumber: raidKey1.issueNumber,
        },
        {
          projectId: project2Id,
          kind: 'risk',
          title: 'Risk 1 in WS2',
          description: 'Description 2',
          issueKeyType: raidKey2.issueKeyType,
          issueNumber: raidKey2.issueNumber,
        },
      ])
      .returning();
    raid1Id = r1!.id;
    raid2Id = r2!.id;
  });

  afterEach(async () => {
    if (closeDatabase) {
      await closeDatabase();
    }
  });

  describe('resolveKnowledgeRecordId', () => {
    it('should resolve UUID directly', async () => {
      const resolved = await resolveKnowledgeRecordId(database, {
        idOrKey: record1Id,
      });
      expect(resolved).toBe(record1Id);
    });

    it('should resolve unique prefix without workspace scoping', async () => {
      const resolved = await resolveKnowledgeRecordId(database, {
        idOrKey: 'PNZ-CONV-1',
      });
      expect(resolved).toBeDefined();
    });

    it('should fail with ambiguous error when duplicate prefix exists without workspace scoping', async () => {
      await expect(
        resolveKnowledgeRecordId(database, {
          idOrKey: 'CSA-CONV-1',
        })
      ).rejects.toThrow(/ambiguous/i);
    });

    it('should resolve correctly when scoped to workspace1', async () => {
      const resolved = await resolveKnowledgeRecordId(database, {
        idOrKey: 'CSA-CONV-1',
        workspaceIds: [workspace1Id],
      });
      expect(resolved).toBe(record1Id);
    });

    it('should resolve correctly when scoped to workspace2', async () => {
      const resolved = await resolveKnowledgeRecordId(database, {
        idOrKey: 'CSA-CONV-1',
        workspaceIds: [workspace2Id],
      });
      expect(resolved).toBe(record2Id);
    });

    it('should fail with ambiguous error when scoped to multiple workspaces both containing the key', async () => {
      await expect(
        resolveKnowledgeRecordId(database, {
          idOrKey: 'CSA-CONV-1',
          workspaceIds: [workspace1Id, workspace2Id],
        })
      ).rejects.toThrow(/ambiguous/i);
    });

    it('should fail with not found when workspace scope excludes the target', async () => {
      await expect(
        resolveKnowledgeRecordId(database, {
          idOrKey: 'CSA-CONV-1',
          workspaceIds: [randomUUID()],
        })
      ).rejects.toThrow(/not found/i);
    });
    
    it('should resolve when prefix matches multiple projects but key exists in only one', async () => {
      // Create another project with CSA prefix but without CONV-1
      const [p4] = await database.db
        .insert(projects)
        .values({
          workspaceId: workspace1Id,
          name: 'Another CSA Project',
          slug: 'another-csa',
          keyPrefix: 'CSA',
        })
        .returning();
      
      // CSA-CONV-1 only exists in project2, so with both workspaces it should resolve
      const resolved = await resolveKnowledgeRecordId(database, {
        idOrKey: 'CSA-CONV-1',
        workspaceIds: [workspace1Id, workspace2Id],
      });
      expect(resolved).toBe(record2Id);
      
      // Clean up
      await database.db
        .delete(projects)
        .where(eq(projects.id, p4.id));
    });

    it('should fail with ambiguous when same key exists in multiple projects with shared prefix', async () => {
      // Create CSA-CONV-1 in project1 as well
      const key1 = await allocateIssueNumber(database, project1Id, 'CONV');
      const [rec3] = await database.db
        .insert(knowledgeRecords)
        .values({
          workspaceId: workspace1Id,
          projectId: project1Id,
          title: 'Duplicate CONV-1 in project1',
          slug: 'conv-1-dup',
          recordType: 'conversation',
          contentMarkdown: 'Duplicate content',
          documentKeyType: key1.issueKeyType,
          documentNumber: key1.issueNumber,
        })
        .returning();
      
      // Now CSA-CONV-1 exists in both projects
      await expect(
        resolveKnowledgeRecordId(database, {
          idOrKey: 'CSA-CONV-1',
          workspaceIds: [workspace1Id, workspace2Id],
        })
      ).rejects.toThrow(/ambiguous/i);
      
      await expect(
        resolveKnowledgeRecordId(database, {
          idOrKey: 'CSA-CONV-1',
        })
      ).rejects.toThrow(/ambiguous/i);
      
      // Clean up
      await database.db
        .delete(knowledgeRecords)
        .where(eq(knowledgeRecords.id, rec3.id));
    });

    it('should resolve with projectId scoping', async () => {
      const resolved = await resolveKnowledgeRecordId(database, {
        idOrKey: 'CSA-CONV-1',
        projectId: project1Id,
      });
      expect(resolved).toBe(record1Id);
    });
  });

  describe('resolveEntityId for tasks', () => {
    it('should resolve UUID directly', async () => {
      const resolved = await resolveEntityId(database, {
        entityType: 'task',
        idOrKey: task1Id,
      });
      expect(resolved).toBe(task1Id);
    });

    it('should fail with ambiguous error when duplicate prefix exists without workspace scoping', async () => {
      await expect(
        resolveEntityId(database, {
          entityType: 'task',
          idOrKey: 'CSA-T-1',
        })
      ).rejects.toThrow(/ambiguous/i);
    });

    it('should resolve correctly when scoped to workspace1', async () => {
      const resolved = await resolveEntityId(database, {
        entityType: 'task',
        idOrKey: 'CSA-T-1',
        workspaceIds: [workspace1Id],
      });
      expect(resolved).toBe(task1Id);
    });

    it('should resolve correctly when scoped to workspace2', async () => {
      const resolved = await resolveEntityId(database, {
        entityType: 'task',
        idOrKey: 'CSA-T-1',
        workspaceIds: [workspace2Id],
      });
      expect(resolved).toBe(task2Id);
    });

    it('should resolve with projectId scoping', async () => {
      const resolved = await resolveEntityId(database, {
        entityType: 'task',
        idOrKey: 'CSA-T-1',
        projectId: project2Id,
      });
      expect(resolved).toBe(task2Id);
    });

    it('should resolve when prefix matches multiple projects but key exists in only one', async () => {
      // CSA-T-1 exists in both projects, but when scoped to workspace2, only task2 should match
      const resolved = await resolveEntityId(database, {
        entityType: 'task',
        idOrKey: 'CSA-T-1',
        workspaceIds: [workspace2Id],
      });
      expect(resolved).toBe(task2Id);
    });

    it('should fail with ambiguous when same key exists in multiple projects', async () => {
      // CSA-T-1 exists in both projects with shared prefix
      await expect(
        resolveEntityId(database, {
          entityType: 'task',
          idOrKey: 'CSA-T-1',
          workspaceIds: [workspace1Id, workspace2Id],
        })
      ).rejects.toThrow(/ambiguous/i);
    });
  });

  describe('resolveEntityId for RAID items', () => {
    it('should resolve UUID directly', async () => {
      const resolved = await resolveEntityId(database, {
        entityType: 'raid',
        idOrKey: raid1Id,
      });
      expect(resolved).toBe(raid1Id);
    });

    it('should fail with ambiguous error when duplicate prefix exists without workspace scoping', async () => {
      await expect(
        resolveEntityId(database, {
          entityType: 'raid',
          idOrKey: 'CSA-RR-1',
        })
      ).rejects.toThrow(/ambiguous/i);
    });

    it('should resolve correctly when scoped to workspace1', async () => {
      const resolved = await resolveEntityId(database, {
        entityType: 'raid',
        idOrKey: 'CSA-RR-1',
        workspaceIds: [workspace1Id],
      });
      expect(resolved).toBe(raid1Id);
    });

    it('should resolve correctly when scoped to workspace2', async () => {
      const resolved = await resolveEntityId(database, {
        entityType: 'raid',
        idOrKey: 'CSA-RR-1',
        workspaceIds: [workspace2Id],
      });
      expect(resolved).toBe(raid2Id);
    });
  });
});
