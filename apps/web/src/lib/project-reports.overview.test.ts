import { describe, expect, it } from 'vitest';
import {
  buildDeliveryStatusReport,
  buildProjectStatusReport,
  buildStakeholdersReport,
  calendarYmd,
  formatReportTimestamp,
  groupReportTasks,
  isTodayOrTomorrow,
  isWithinLast24Hours,
  selectCompletedLast24h,
  selectPlannedNext24h,
  REPORT_CLOSED_GROUP_LIMIT,
  type ReportMilestone,
  type ReportOverviewCopy,
  type ReportSprint,
  type ReportTask,
} from './project-reports';

const NOW = new Date('2026-10-10T06:00:00.000Z');
const LA = 'America/Los_Angeles';
const KIRITIMATI = 'Pacific/Kiritimati';

function hoursBefore(hours: number): string {
  return new Date(NOW.getTime() - hours * 60 * 60 * 1000).toISOString();
}

function task(overrides: Partial<ReportTask> & Pick<ReportTask, 'title'>): ReportTask {
  return {
    status: 'todo',
    dueDate: null,
    milestoneId: null,
    forecastHours: null,
    actualHours: null,
    ...overrides,
  };
}

function overviewCopy(): ReportOverviewCopy {
  return {
    atAGlance: 'At a glance',
    keyNumbers: (input) =>
      `${input.total} tasks · recent ${input.completedRecent} · soon ${input.dueSoon}`,
    completedLast24h: 'Completed in the last 24 hours',
    plannedNext24h: 'Planned for the next 24 hours',
    whereWeStand: 'Where we stand',
    groupBlocked: 'Blocked',
    groupInProgress: 'In progress',
    groupTodo: 'To do',
    groupDone: 'Done',
    groupCancelled: 'Cancelled',
    more: (count) => `+${count} more`,
    none: 'None',
    overdueLine: (count, titles) => `Overdue ${count}: ${titles}`,
    blockedRisksLine: (input) =>
      `Blocked ${input.blockedCount}: ${input.blockedTitles}. Risks ${input.riskCount}: ${input.riskTitles}`,
    activeSprintLine: (input) =>
      `Sprint ${input.name} ${input.done}/${input.committed} (${input.pct}%)`,
    noActiveSprint: 'No active sprint',
    nextMilestoneLine: (input) =>
      `${input.title} — ${input.days} days (${input.date})`,
    noNextMilestone: 'No upcoming milestone',
    cpiSpiLine: (input) => `CPI ${input.cpi} · SPI ${input.spi}`,
    ownerWorkloadLine: (owners) => `Owners: ${owners}`,
    due: (date) => `due ${date}`,
    points: (count) => `${count} pt`,
    target: (date) => `target ${date}`,
    sprintStarts: (date) => `starts ${date}`,
    sprintEnds: (date) => `ends ${date}`,
    sprintWindow: (start, end) => `starts ${start}, ends ${end}`,
    taskKind: 'Task',
    milestoneKind: 'Milestone',
    sprintKind: 'Sprint',
  };
}

const labels = {
  title: 'Delivery',
  generated: 'Generated',
  timelineRag: 'Timeline',
  timelineRagValue: 'On track',
  milestones: 'Milestones',
  tasks: 'Tasks',
  none: 'None',
  forecastHours: 'Forecast hours',
  actualHours: 'Actual hours',
  diagramEmpty: 'No data for this diagram.',
};

describe('report timestamps', () => {
  const instant = new Date('2026-10-07T21:53:09.212Z');
  const zone = 'Europe/Budapest';

  it('formats the generated clock time in the UI locale and viewer zone', () => {
    expect(formatReportTimestamp(instant, 'en', zone)).toBe(
      '7 Oct 2026, 23:53 (CEST)',
    );
    expect(formatReportTimestamp(instant, 'hu', zone)).toBe(
      '2026. 10. 07. 23:53 (CEST)',
    );
    expect(formatReportTimestamp(instant, 'de', zone)).toBe(
      '07.10.2026, 23:53 (MESZ)',
    );
  });

  it('keeps date-only due dates unchanged and does not emit a raw ISO clock', () => {
    const markdown = buildDeliveryStatusReport({
      projectName: 'Lab',
      projectSlug: 'lab',
      projectStatus: 'active',
      milestones: [],
      tasks: [
        task({
          title: 'Due tomorrow',
          status: 'todo',
          dueDate: '2026-10-08',
          completedAt: instant.toISOString(),
        }),
      ],
      now: instant,
      timeZone: zone,
      locale: 'hu',
      diagrams: {
        orgHierarchy: false,
        raidBreakdown: false,
        deliveryTimeline: false,
        budgetBurndown: false,
      },
      labels,
    });
    expect(markdown).toContain('Generated: 2026. 10. 07. 23:53 (CEST)');
    expect(markdown).toContain('due 2026-10-08');
    expect(markdown).not.toContain('2026-10-07T21:53:09.212Z');
    expect(markdown).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
  });

  it('uses the same formatted stamp on the status report and the stakeholder section', () => {
    const stamp = formatReportTimestamp(instant, 'en', zone);
    const markdown = buildProjectStatusReport({
      projectName: 'Lab',
      projectSlug: 'lab',
      projectStatus: 'active',
      summary: null,
      milestones: [],
      tasks: [],
      stakeholders: [],
      raidItems: [],
      budget: null,
      now: instant,
      timeZone: zone,
      locale: 'en',
      diagrams: {
        orgHierarchy: false,
        raidBreakdown: false,
        deliveryTimeline: false,
        budgetBurndown: false,
      },
      diagramLabels: {
        orgHierarchy: 'Org',
        raidBreakdown: 'RAID',
        deliveryTimeline: 'Timeline',
        budgetBurndown: 'Budget',
        milestonesSection: 'Milestones',
        tasksSection: 'Tasks',
      },
      labels: {
        statusTitle: 'Status',
        deliveryTitle: 'Delivery',
        stakeholdersTitle: 'People',
        budgetTitle: 'Budget',
        raidTitle: 'RAID',
        generated: 'Generated',
        timelineRag: 'Timeline',
        timelineRagValue: 'On track',
        riskRag: 'Risks',
        riskRagValue: 'On track',
        financialRag: 'Financials',
        financialRagValue: 'On track',
        milestones: 'Milestones',
        tasks: 'Tasks',
        people: 'People',
        aiAssistants: 'Assistants',
        none: 'None',
        reportsTo: 'Reports to',
        hourlyRate: 'Rate',
        summary: 'Summary',
        forecastHours: 'Forecast',
        actualHours: 'Actual',
        currency: 'Currency',
        initialBudget: 'Initial',
        approvedBudget: 'Approved',
        bac: 'BAC',
        ev: 'EV',
        ac: 'AC',
        pv: 'PV',
        cpi: 'CPI',
        spi: 'SPI',
        diagramEmpty: 'No data for this diagram.',
      },
      kindLabel: (kind) => kind,
      statusLabel: (status) => status,
      severityLabel: (severity) => severity,
    });
    const hits = markdown.match(/Generated: 7 Oct 2026, 23:53 \(CEST\)/g) ?? [];
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(markdown).toContain(stamp);
    expect(markdown).not.toContain(instant.toISOString());

    const people = buildStakeholdersReport({
      projectName: 'Lab',
      projectSlug: 'lab',
      stakeholders: [],
      locale: 'en',
      now: instant,
      timeZone: zone,
      diagrams: {
        orgHierarchy: false,
        raidBreakdown: false,
        deliveryTimeline: false,
        budgetBurndown: false,
      },
      labels: {
        title: 'People',
        generated: 'Generated',
        people: 'People',
        aiAssistants: 'Assistants',
        none: 'None',
        reportsTo: 'Reports to',
        hourlyRate: 'Rate',
        diagramEmpty: 'No data for this diagram.',
      },
    });
    expect(people).toContain('Generated: 7 Oct 2026, 23:53 (CEST)');
  });
});

describe('report time windows', () => {
  it('includes the last 24 hours on both edges and drops 30h', () => {
    expect(isWithinLast24Hours(hoursBefore(2), NOW)).toBe(true);
    expect(isWithinLast24Hours(hoursBefore(30), NOW)).toBe(false);
    expect(isWithinLast24Hours(hoursBefore(24), NOW)).toBe(true);
    expect(isWithinLast24Hours(NOW.toISOString(), NOW)).toBe(true);
    expect(isWithinLast24Hours(hoursBefore(-0.001), NOW)).toBe(false);
    const justOutside = new Date(NOW.getTime() - 24 * 60 * 60 * 1000 - 1);
    expect(isWithinLast24Hours(justOutside.toISOString(), NOW)).toBe(false);
    expect(isWithinLast24Hours(null, NOW)).toBe(false);
  });

  it('uses the viewer calendar, so a UTC tomorrow is not LA tomorrow', () => {
    expect(calendarYmd(NOW, LA)).toBe('2026-10-09');
    expect(calendarYmd(NOW, KIRITIMATI)).toBe('2026-10-10');
    expect(calendarYmd(NOW, 'UTC')).toBe('2026-10-10');

    const laToday = calendarYmd(NOW, LA);
    expect(isTodayOrTomorrow('2026-10-09', laToday)).toBe(true);
    expect(isTodayOrTomorrow('2026-10-10', laToday)).toBe(true);
    expect(isTodayOrTomorrow('2026-10-11', laToday)).toBe(false);
    expect(isTodayOrTomorrow('2026-10-08', laToday)).toBe(false);
  });

  it('keeps a 2h completion and drops a 30h one', () => {
    const recent = task({
      title: 'Recent',
      status: 'done',
      completedAt: hoursBefore(2),
    });
    const old = task({
      title: 'Old',
      status: 'done',
      completedAt: hoursBefore(30),
    });
    const selected = selectCompletedLast24h([old, recent], NOW);
    expect(selected.map((row) => row.title)).toEqual(['Recent']);
  });

  it('plans open work due today or tomorrow and ignores a date three days out', () => {
    const today = calendarYmd(NOW, LA);
    const tasks = [
      task({ title: 'Today', status: 'in_progress', dueDate: today }),
      task({ title: 'Tomorrow', status: 'todo', dueDate: '2026-10-10' }),
      task({ title: 'Later', status: 'todo', dueDate: '2026-10-11' }),
      task({ title: 'Done today', status: 'done', dueDate: today }),
      task({ title: 'Blocked soon', status: 'blocked', dueDate: '2026-10-10' }),
    ];
    const milestones: ReportMilestone[] = [
      { title: 'Soon', status: 'planned', targetDate: '2026-10-10' },
      { title: 'Far', status: 'active', targetDate: '2026-10-20' },
      { title: 'Finished', status: 'done', targetDate: today },
    ];
    const sprints: ReportSprint[] = [
      {
        id: 'sp-window',
        name: 'Spike',
        status: 'planned',
        startDate: '2026-10-10',
        endDate: '2026-10-12',
      },
      {
        id: 'sp-later',
        name: 'Later sprint',
        status: 'planned',
        startDate: '2026-10-20',
        endDate: '2026-10-27',
      },
    ];
    const planned = selectPlannedNext24h({ tasks, milestones, sprints, today });
    expect(planned.map((item) => item.title)).toEqual([
      'Today',
      'Blocked soon',
      'Tomorrow',
      'Soon',
      'Spike',
    ]);
    expect(planned.find((item) => item.title === 'Spike')?.sprintEdge).toBe('start');
  });
});

describe('report task grouping', () => {
  it('orders groups, hides empty ones, and sorts by due date then title', () => {
    const groups = groupReportTasks([
      task({ title: 'Zed', status: 'todo', dueDate: null }),
      task({ title: 'Amy', status: 'todo', dueDate: '2026-10-12' }),
      task({ title: 'Bea', status: 'todo', dueDate: '2026-10-11' }),
      task({ title: 'Blocked late', status: 'blocked', dueDate: '2026-10-20' }),
      task({ title: 'Blocked early', status: 'blocked', dueDate: '2026-10-01' }),
      task({ title: 'Doing', status: 'in_progress', dueDate: '2026-10-09' }),
    ]);
    expect(groups.map((group) => group.status)).toEqual([
      'blocked',
      'in_progress',
      'todo',
    ]);
    expect(groups[0]?.tasks.map((row) => row.title)).toEqual([
      'Blocked early',
      'Blocked late',
    ]);
    expect(groups[2]?.tasks.map((row) => row.title)).toEqual(['Bea', 'Amy', 'Zed']);
  });

  it('truncates only done and cancelled', () => {
    const done = Array.from({ length: REPORT_CLOSED_GROUP_LIMIT + 3 }, (_, index) =>
      task({
        title: `Done ${String(index).padStart(2, '0')}`,
        status: 'done',
        dueDate: `2026-10-${String((index % 28) + 1).padStart(2, '0')}`,
      }),
    );
    const open = Array.from({ length: 10 }, (_, index) =>
      task({ title: `Open ${index}`, status: 'todo', dueDate: '2026-10-10' }),
    );
    const groups = groupReportTasks([...done, ...open]);
    const doneGroup = groups.find((group) => group.status === 'done');
    const openGroup = groups.find((group) => group.status === 'todo');
    expect(doneGroup?.tasks).toHaveLength(REPORT_CLOSED_GROUP_LIMIT);
    expect(doneGroup?.hiddenCount).toBe(3);
    expect(openGroup?.tasks).toHaveLength(10);
    expect(openGroup?.hiddenCount).toBe(0);
  });
});

describe('report markdown order', () => {
  const tasks = [
    task({
      title: 'Shipped',
      status: 'done',
      completedAt: hoursBefore(2),
      humanKey: 'T-9',
    }),
    task({
      title: 'Old ship',
      status: 'done',
      completedAt: hoursBefore(30),
    }),
  ];

  it('omits the planned section when the window is empty', () => {
    const markdown = buildDeliveryStatusReport({
      projectName: 'Lab',
      projectSlug: 'lab',
      projectStatus: 'active',
      milestones: [],
      tasks,
      now: NOW,
      timeZone: 'UTC',
      overview: overviewCopy(),
      diagrams: {
        orgHierarchy: false,
        raidBreakdown: false,
        deliveryTimeline: false,
        budgetBurndown: false,
      },
      labels,
    });
    expect(markdown.indexOf('## At a glance')).toBeLessThan(
      markdown.indexOf('## Completed in the last 24 hours'),
    );
    expect(markdown.indexOf('## Completed in the last 24 hours')).toBeLessThan(
      markdown.indexOf('## Where we stand'),
    );
    const completedAt = markdown.indexOf('## Completed in the last 24 hours');
    const standAt = markdown.indexOf('## Where we stand');
    const completedBody = markdown.slice(completedAt, standAt);
    expect(completedBody).toContain('**T-9** **Shipped**');
    expect(completedBody).not.toContain('Old ship');
    expect(markdown).not.toContain('## Planned for the next 24 hours');
    expect(markdown).toContain('### Done (2)');
    expect(markdown).not.toContain('### To do');
    expect(markdown).toContain('No active sprint');
    expect(markdown).toContain('No upcoming milestone');
  });

  it('puts delivery, including the glance, before budget on the status report', () => {
    const markdown = buildProjectStatusReport({
      projectName: 'Lab',
      projectSlug: 'lab',
      projectStatus: 'active',
      summary: null,
      milestones: [
        { title: 'Next', status: 'active', targetDate: '2026-10-12' },
      ],
      tasks,
      stakeholders: [],
      raidItems: [
        {
          kind: 'risk',
          title: 'Colon risk',
          status: 'open',
          severity: 'critical',
        },
        {
          kind: 'issue',
          title: 'Not a risk',
          status: 'open',
          severity: 'critical',
        },
      ],
      budget: {
        currency: 'EUR',
        initialBudget: 10,
        approvedBudget: 10,
        bac: 10,
        pv: 8,
        ev: 6,
        ac: 9,
        cpi: 0.67,
        spi: 0.75,
        financialRag: 'amber',
        riskRag: 'red',
      },
      sprints: [
        {
          id: 'sp1',
          name: 'Active',
          status: 'active',
          startDate: '2026-10-01',
          endDate: '2026-10-14',
          committedPoints: 8,
          donePoints: 2,
        },
      ],
      now: NOW,
      timeZone: 'UTC',
      overview: overviewCopy(),
      diagrams: {
        orgHierarchy: false,
        raidBreakdown: false,
        deliveryTimeline: false,
        budgetBurndown: false,
      },
      diagramLabels: {
        orgHierarchy: 'Org',
        raidBreakdown: 'RAID',
        deliveryTimeline: 'Timeline',
        budgetBurndown: 'Budget',
        milestonesSection: 'Milestones',
        tasksSection: 'Tasks',
      },
      labels: {
        statusTitle: 'Status',
        deliveryTitle: 'Delivery',
        stakeholdersTitle: 'People',
        budgetTitle: 'Budget',
        raidTitle: 'RAID',
        generated: 'Generated',
        timelineRag: 'Timeline',
        timelineRagValue: 'On track',
        riskRag: 'Risks',
        riskRagValue: 'Off track',
        financialRag: 'Financials',
        financialRagValue: 'At risk',
        milestones: 'Milestones',
        tasks: 'Tasks',
        people: 'People',
        aiAssistants: 'Assistants',
        none: 'None',
        reportsTo: 'Reports to',
        hourlyRate: 'Rate',
        summary: 'Summary',
        forecastHours: 'Forecast',
        actualHours: 'Actual',
        currency: 'Currency',
        initialBudget: 'Initial',
        approvedBudget: 'Approved',
        bac: 'BAC',
        ev: 'EV',
        ac: 'AC',
        pv: 'PV',
        cpi: 'CPI',
        spi: 'SPI',
        diagramEmpty: 'No data for this diagram.',
      },
      kindLabel: (kind) => kind,
      statusLabel: (status) => status,
      severityLabel: (severity) => severity,
    });
    const glance = markdown.indexOf('## At a glance');
    const budget = markdown.indexOf('## Budget');
    const raid = markdown.indexOf('## RAID');
    expect(glance).toBeGreaterThan(-1);
    expect(glance).toBeLessThan(budget);
    expect(budget).toBeLessThan(raid);
    const stand = markdown.indexOf('## Where we stand');
    const taskHeading = markdown.indexOf('## Tasks');
    const standBody = markdown.slice(stand, taskHeading);
    expect(standBody).toContain('Sprint Active 2/8 (25%)');
    expect(standBody).toContain('CPI 0.67 · SPI 0.75');
    expect(standBody).toContain('Risks 1');
    expect(standBody).toContain('Colon risk');
    expect(standBody).not.toContain('Not a risk');
    expect(standBody).toContain('Next — 2 days (2026-10-12)');
  });
});
