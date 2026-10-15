import { and, eq, inArray, isNull, ne } from 'drizzle-orm';
import type { Database } from '@project-knowledge-hub/database';
import {
  projectEpics,
  projectMilestones,
  projectNonWorkingDays,
  projectSprints,
  projectTasks,
  projectUserStories,
  projects,
} from '@project-knowledge-hub/database';
import {
  coerceProjectCalendar,
  normalizeNonWorkingDays,
  NON_WORKING_DAY_LIMIT,
  planDurationWorkingDays,
  planWindowFromDatedItems,
  type PlanDateSpan,
  type ProjectWorkingCalendar,
} from '@project-knowledge-hub/domain';

export type ProjectScheduleFacts = {
  nonWorkingDays: string[];
  finishDate: string | null;
  durationWorkingDays: number | null;
};

type CalendarProject = {
  id: string;
  hoursPerWorkday?: number | string | null;
  workdaysPerWeek?: number | null;
};

type DatedRow = {
  projectId: string;
  start: string | null;
  end: string | null;
};

function remember(
  into: Map<string, PlanDateSpan[]>,
  projectId: string | null | undefined,
  start: string | null | undefined,
  end: string | null | undefined,
): void {
  if (!projectId) return;
  if (!start && !end) return;
  const list = into.get(projectId) ?? [];
  list.push({ start: start ?? null, end: end ?? null });
  into.set(projectId, list);
}

export async function loadProjectCalendar(
  database: Database,
  projectId: string,
): Promise<ProjectWorkingCalendar> {
  const [project] = await database.db
    .select({
      hoursPerWorkday: projects.hoursPerWorkday,
      workdaysPerWeek: projects.workdaysPerWeek,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  const days = await database.db
    .select({ day: projectNonWorkingDays.day })
    .from(projectNonWorkingDays)
    .where(eq(projectNonWorkingDays.projectId, projectId))
    .limit(NON_WORKING_DAY_LIMIT);
  return coerceProjectCalendar({
    hoursPerWorkday: project?.hoursPerWorkday,
    workdaysPerWeek: project?.workdaysPerWeek,
    nonWorkingDays: days
      .map((row) => row.day)
      .filter((day): day is string => typeof day === 'string'),
  });
}

export async function replaceProjectNonWorkingDays(
  database: Database,
  projectId: string,
  days: readonly string[],
): Promise<string[]> {
  const normalized = normalizeNonWorkingDays(days);
  await database.db
    .delete(projectNonWorkingDays)
    .where(eq(projectNonWorkingDays.projectId, projectId));
  if (normalized.length > 0) {
    await database.db.insert(projectNonWorkingDays).values(
      normalized.map((day) => ({ projectId, day })),
    );
  }
  return normalized;
}

/**
 * Plan finish and working-day duration from scheduled delivery items.
 * Parent rows already store the PRO-T-73 rollup (earliest child start,
 * latest child end). Cancelled and archived items are left out, matching
 * that rollup. The window is the earliest remaining start to the latest end.
 */
export async function loadProjectScheduleFacts(
  database: Database,
  rows: readonly CalendarProject[],
): Promise<Map<string, ProjectScheduleFacts>> {
  const result = new Map<string, ProjectScheduleFacts>();
  const projectIds = rows.map((row) => row.id);
  if (projectIds.length === 0) return result;

  const [holidays, tasks, stories, epics, milestones, sprints] = await Promise.all([
    database.db
      .select({
        projectId: projectNonWorkingDays.projectId,
        day: projectNonWorkingDays.day,
      })
      .from(projectNonWorkingDays)
      .where(inArray(projectNonWorkingDays.projectId, projectIds)),
    database.db
      .select({
        projectId: projectTasks.projectId,
        start: projectTasks.startDate,
        end: projectTasks.dueDate,
      })
      .from(projectTasks)
      .where(
        and(
          inArray(projectTasks.projectId, projectIds),
          isNull(projectTasks.archivedAt),
          ne(projectTasks.status, 'cancelled'),
        ),
      ),
    database.db
      .select({
        projectId: projectUserStories.projectId,
        start: projectUserStories.startDate,
        end: projectUserStories.endDate,
      })
      .from(projectUserStories)
      .where(
        and(
          inArray(projectUserStories.projectId, projectIds),
          isNull(projectUserStories.archivedAt),
          ne(projectUserStories.status, 'cancelled'),
        ),
      ),
    database.db
      .select({
        projectId: projectEpics.projectId,
        start: projectEpics.startDate,
        end: projectEpics.endDate,
      })
      .from(projectEpics)
      .where(
        and(
          inArray(projectEpics.projectId, projectIds),
          isNull(projectEpics.archivedAt),
          ne(projectEpics.status, 'cancelled'),
        ),
      ),
    database.db
      .select({
        projectId: projectMilestones.projectId,
        start: projectMilestones.startDate,
        end: projectMilestones.targetDate,
      })
      .from(projectMilestones)
      .where(
        and(
          inArray(projectMilestones.projectId, projectIds),
          isNull(projectMilestones.archivedAt),
          ne(projectMilestones.status, 'cancelled'),
        ),
      ),
    database.db
      .select({
        projectId: projectSprints.projectId,
        start: projectSprints.startDate,
        end: projectSprints.endDate,
      })
      .from(projectSprints)
      .where(
        and(
          inArray(projectSprints.projectId, projectIds),
          isNull(projectSprints.archivedAt),
          ne(projectSprints.status, 'cancelled'),
        ),
      ),
  ]);

  const holidaysByProject = new Map<string, string[]>();
  for (const row of holidays) {
    if (!row.projectId || typeof row.day !== 'string') continue;
    const list = holidaysByProject.get(row.projectId) ?? [];
    list.push(row.day);
    holidaysByProject.set(row.projectId, list);
  }

  const dated = new Map<string, PlanDateSpan[]>();
  const spans: DatedRow[] = [...tasks, ...stories, ...epics, ...milestones, ...sprints];
  for (const row of spans) {
    remember(dated, row.projectId, row.start, row.end);
  }

  for (const project of rows) {
    const nonWorkingDays = [...(holidaysByProject.get(project.id) ?? [])].sort();
    const calendar = coerceProjectCalendar({
      hoursPerWorkday: project.hoursPerWorkday,
      workdaysPerWeek: project.workdaysPerWeek,
      nonWorkingDays,
    });
    const window = planWindowFromDatedItems(dated.get(project.id) ?? []);
    result.set(project.id, {
      nonWorkingDays: calendar.nonWorkingDays.slice(),
      finishDate: window.finish,
      durationWorkingDays: planDurationWorkingDays(window, calendar),
    });
  }
  return result;
}
