import { and, eq, inArray } from 'drizzle-orm';
import { slugify } from '@project-knowledge-hub/auth';
import {
  knowledgeRecordTags,
  projectTags,
  systemTags,
  tags,
  type Database,
} from '@project-knowledge-hub/database';

export async function resolveTagsForOrganization(
  database: Database,
  organizationId: string,
  tagNames: string[],
): Promise<Array<{ id: string; name: string; slug: string }>> {
  const normalized = [
    ...new Set(
      tagNames
        .map((name) => name.trim())
        .filter((name) => name.length > 0)
        .map((name) => ({ name, slug: slugify(name) }))
        .filter((item) => item.slug.length > 0),
    ),
  ];

  // Deduplicate by slug
  const bySlug = new Map<string, { name: string; slug: string }>();
  for (const item of normalized) {
    if (!bySlug.has(item.slug)) {
      bySlug.set(item.slug, item);
    }
  }
  const desired = [...bySlug.values()];
  if (desired.length === 0) {
    return [];
  }

  const existing = await database.db
    .select()
    .from(tags)
    .where(
      and(
        eq(tags.organizationId, organizationId),
        inArray(
          tags.slug,
          desired.map((item) => item.slug),
        ),
      ),
    );

  const existingBySlug = new Map(existing.map((tag) => [tag.slug, tag]));
  const created: Array<{ id: string; name: string; slug: string }> = [];

  for (const item of desired) {
    const found = existingBySlug.get(item.slug);
    if (found) {
      created.push({ id: found.id, name: found.name, slug: found.slug });
      continue;
    }
    const [inserted] = await database.db
      .insert(tags)
      .values({
        organizationId,
        name: item.name,
        slug: item.slug,
      })
      .returning();
    if (inserted) {
      created.push({ id: inserted.id, name: inserted.name, slug: inserted.slug });
    }
  }

  return created;
}

export async function setProjectTags(
  database: Database,
  projectId: string,
  organizationId: string,
  tagNames: string[],
): Promise<Array<{ id: string; name: string; slug: string }>> {
  const resolved = await resolveTagsForOrganization(database, organizationId, tagNames);
  await database.db.delete(projectTags).where(eq(projectTags.projectId, projectId));
  if (resolved.length > 0) {
    await database.db.insert(projectTags).values(
      resolved.map((tag) => ({
        projectId,
        tagId: tag.id,
      })),
    );
  }
  return resolved;
}

export async function setSystemTags(
  database: Database,
  systemId: string,
  organizationId: string,
  tagNames: string[],
): Promise<Array<{ id: string; name: string; slug: string }>> {
  const resolved = await resolveTagsForOrganization(database, organizationId, tagNames);
  await database.db.delete(systemTags).where(eq(systemTags.systemId, systemId));
  if (resolved.length > 0) {
    await database.db.insert(systemTags).values(
      resolved.map((tag) => ({
        systemId,
        tagId: tag.id,
      })),
    );
  }
  return resolved;
}

export async function getProjectTags(
  database: Database,
  projectIds: string[],
): Promise<Map<string, Array<{ id: string; name: string; slug: string }>>> {
  const result = new Map<string, Array<{ id: string; name: string; slug: string }>>();
  if (projectIds.length === 0) {
    return result;
  }

  const rows = await database.db
    .select({
      projectId: projectTags.projectId,
      id: tags.id,
      name: tags.name,
      slug: tags.slug,
    })
    .from(projectTags)
    .innerJoin(tags, eq(projectTags.tagId, tags.id))
    .where(inArray(projectTags.projectId, projectIds));

  for (const row of rows) {
    const list = result.get(row.projectId) ?? [];
    list.push({ id: row.id, name: row.name, slug: row.slug });
    result.set(row.projectId, list);
  }
  return result;
}

export async function getSystemTags(
  database: Database,
  systemIds: string[],
): Promise<Map<string, Array<{ id: string; name: string; slug: string }>>> {
  const result = new Map<string, Array<{ id: string; name: string; slug: string }>>();
  if (systemIds.length === 0) {
    return result;
  }

  const rows = await database.db
    .select({
      systemId: systemTags.systemId,
      id: tags.id,
      name: tags.name,
      slug: tags.slug,
    })
    .from(systemTags)
    .innerJoin(tags, eq(systemTags.tagId, tags.id))
    .where(inArray(systemTags.systemId, systemIds));

  for (const row of rows) {
    const list = result.get(row.systemId) ?? [];
    list.push({ id: row.id, name: row.name, slug: row.slug });
    result.set(row.systemId, list);
  }
  return result;
}

export async function setKnowledgeRecordTags(
  database: Database,
  knowledgeRecordId: string,
  organizationId: string,
  tagNames: string[],
): Promise<Array<{ id: string; name: string; slug: string }>> {
  const resolved = await resolveTagsForOrganization(database, organizationId, tagNames);
  await database.db
    .delete(knowledgeRecordTags)
    .where(eq(knowledgeRecordTags.knowledgeRecordId, knowledgeRecordId));
  if (resolved.length > 0) {
    await database.db.insert(knowledgeRecordTags).values(
      resolved.map((tag) => ({
        knowledgeRecordId,
        tagId: tag.id,
      })),
    );
  }
  return resolved;
}

export async function getKnowledgeRecordTags(
  database: Database,
  recordIds: string[],
): Promise<Map<string, Array<{ id: string; name: string; slug: string }>>> {
  const result = new Map<string, Array<{ id: string; name: string; slug: string }>>();
  if (recordIds.length === 0) {
    return result;
  }

  const rows = await database.db
    .select({
      knowledgeRecordId: knowledgeRecordTags.knowledgeRecordId,
      id: tags.id,
      name: tags.name,
      slug: tags.slug,
    })
    .from(knowledgeRecordTags)
    .innerJoin(tags, eq(knowledgeRecordTags.tagId, tags.id))
    .where(inArray(knowledgeRecordTags.knowledgeRecordId, recordIds));

  for (const row of rows) {
    const list = result.get(row.knowledgeRecordId) ?? [];
    list.push({ id: row.id, name: row.name, slug: row.slug });
    result.set(row.knowledgeRecordId, list);
  }
  return result;
}
