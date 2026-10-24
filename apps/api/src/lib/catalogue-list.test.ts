import { describe, expect, it } from 'vitest';
import { toProjectPickerRow } from '../routes/projects.js';
import {
  knowledgeRecordListSelect,
  toPublicRecord,
} from './knowledge-records-service.js';
import { systemCatalogueColumns, toCatalogueSystem } from './systems.js';

describe('catalogue list columns', () => {
  it('does not read knowledge-record bodies on the list', () => {
    expect(Object.keys(knowledgeRecordListSelect)).not.toContain('contentMarkdown');
    expect(Object.keys(knowledgeRecordListSelect)).not.toContain('contentHtmlCache');
    expect(Object.keys(knowledgeRecordListSelect)).toContain('title');
    expect(Object.keys(systemCatalogueColumns)).not.toContain('description');
    expect(Object.keys(systemCatalogueColumns)).not.toContain('itDetails');
    expect(Object.keys(systemCatalogueColumns)).toContain('name');
  });

  it('omits markdown from a listed record and keeps the title', () => {
    const listed = toPublicRecord(
      {
        id: 'r1',
        workspaceId: 'w1',
        projectId: null,
        systemId: null,
        title: 'Charter',
        slug: 'charter',
        summary: null,
        recordType: 'note',
        lifecycleStatus: 'draft',
        sourceOfTruthMode: 'hub_managed',
        contentMarkdown: '# full body',
        contentHtmlCache: '<h1>full body</h1>',
        language: 'en',
        translationGroupId: null,
        documentKeyType: null,
        documentNumber: null,
        metadataJson: null,
        currentVersionNumber: 1,
        supersedesRecordId: null,
        createdBy: 'u1',
        reviewedBy: null,
        verifiedAt: null,
        lastValidatedAt: null,
        archivedAt: null,
        createdAt: new Date('2026-10-24T00:00:00Z'),
        updatedAt: new Date('2026-10-24T00:00:00Z'),
      },
      [],
      null,
      { includeContent: false },
    );
    expect(listed.title).toBe('Charter');
    expect(listed).not.toHaveProperty('contentMarkdown');
    expect(listed).not.toHaveProperty('contentHtml');
  });

  it('keeps a project picker free of health totals', () => {
    expect(toProjectPickerRow({
      id: 'p1',
      name: 'Alpha',
      slug: 'alpha',
      status: 'active',
    })).toEqual({
      id: 'p1',
      name: 'Alpha',
      slug: 'alpha',
      status: 'active',
    });
  });

  it('does not invent system cost figures for a catalogue row', () => {
    const system = toCatalogueSystem(
      {
        id: 's1',
        workspaceId: 'w1',
        projectId: null,
        name: 'API',
        slug: 'api',
        summary: null,
        status: 'active',
        systemType: null,
        archivedAt: null,
        createdAt: new Date('2026-10-24T00:00:00Z'),
        updatedAt: new Date('2026-10-24T00:00:00Z'),
      },
      [],
    );
    expect(system.name).toBe('API');
    expect(system.description).toBeNull();
    expect(system.aiFlatMonthlyFee).toBeNull();
    expect(system.itFlatMonthlyFee).toBeNull();
  });
});