import {
  deliveryScheduleTone,
  projectDeliveryRag,
  todayYmd,
  type ProjectRagStatus,
} from './delivery-schedule';
import { formatMoney } from './project-currency';
import { computeRiskRag } from './project-health';

export type ReportMilestone = {
  title: string;
  status: string;
  targetDate: string | null;
};

export type ReportTask = {
  title: string;
  status: string;
  dueDate: string | null;
  milestoneId: string | null;
  forecastHours: string | null;
  actualHours: string | null;
};

export type ReportStakeholder = {
  kind: string;
  displayName: string;
  email: string | null;
  projectRole: string | null;
  jobTitle: string | null;
  reportsToUserId: string | null;
  hourlyRate: string | null;
  raciRoles: string[];
  notes: string | null;
  userId: string | null;
};

export type ReportRaidItem = {
  kind: string;
  title: string;
  status: string;
  severity: string;
};

export type ReportBudgetSummary = {
  currency: string;
  initialBudget: number | null;
  approvedBudget: number | null;
  bac: number | null;
  pv: number | null;
  ev: number;
  ac: number;
  cpi: number | null;
  spi: number | null;
  financialRag: ProjectRagStatus;
  riskRag: ProjectRagStatus;
};

export type ProjectReportData = {
  milestones: ReportMilestone[];
  tasks: ReportTask[];
  stakeholders: ReportStakeholder[];
  raidItems: ReportRaidItem[];
  budget: ReportBudgetSummary | null;
};

function downloadMarkdown(filename: string, markdown: string) {
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64) || 'project';
}

function formatIndex(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toFixed(2);
}

function formatHours(value: string | null | undefined): string | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return String(n);
}

export async function fetchProjectReportData(
  projectId: string,
): Promise<ProjectReportData> {
  const [milestonesRes, tasksRes, stakeholdersRes, raidRes, budgetRes] =
    await Promise.all([
      fetch(`/api/v1/projects/${projectId}/milestones`),
      fetch(`/api/v1/projects/${projectId}/tasks`),
      fetch(`/api/v1/projects/${projectId}/stakeholders`),
      fetch(`/api/v1/projects/${projectId}/raid-items`),
      fetch(`/api/v1/projects/${projectId}/budget-summary`),
    ]);

  const milestones = milestonesRes.ok
    ? ((await milestonesRes.json()) as { milestones: ReportMilestone[] })
        .milestones
    : [];
  const tasks = tasksRes.ok
    ? ((await tasksRes.json()) as { tasks: ReportTask[] }).tasks
    : [];
  const stakeholders = stakeholdersRes.ok
    ? ((await stakeholdersRes.json()) as {
        stakeholders: ReportStakeholder[];
      }).stakeholders
    : [];
  const raidItems = raidRes.ok
    ? ((await raidRes.json()) as { raidItems: ReportRaidItem[] }).raidItems
    : [];
  const budget = budgetRes.ok
    ? ((await budgetRes.json()) as { budget: ReportBudgetSummary }).budget
    : null;

  return { milestones, tasks, stakeholders, raidItems, budget };
}

function nameByUserId(stakeholders: ReportStakeholder[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of stakeholders) {
    if (row.userId) map.set(row.userId, row.displayName);
  }
  return map;
}

export function computeReportRags(input: {
  milestones: ReportMilestone[];
  tasks: ReportTask[];
  raidItems: ReportRaidItem[];
  budget: ReportBudgetSummary | null;
  today?: string;
}): {
  timelineRag: ProjectRagStatus;
  riskRag: ProjectRagStatus;
  financialRag: ProjectRagStatus;
} {
  const today = input.today ?? todayYmd();
  return {
    timelineRag: projectDeliveryRag(
      [
        ...input.milestones.map((row) => ({
          status: row.status,
          date: row.targetDate,
        })),
        ...input.tasks.map((row) => ({ status: row.status, date: row.dueDate })),
      ],
      today,
    ),
    riskRag: input.budget?.riskRag ?? computeRiskRag(input.raidItems),
    financialRag: input.budget?.financialRag ?? 'green',
  };
}

export function buildDeliveryStatusReport(input: {
  projectName: string;
  projectSlug: string;
  projectStatus: string;
  milestones: ReportMilestone[];
  tasks: ReportTask[];
  labels: {
    title: string;
    generated: string;
    timelineRag: string;
    timelineRagValue: string;
    milestones: string;
    tasks: string;
    none: string;
    forecastHours: string;
    actualHours: string;
  };
}): string {
  const today = todayYmd();

  const lines = [
    `# ${input.labels.title}: ${input.projectName}`,
    '',
    `- Slug: \`${input.projectSlug}\``,
    `- Status: ${input.projectStatus}`,
    `- ${input.labels.timelineRag}: **${input.labels.timelineRagValue}**`,
    `- ${input.labels.generated}: ${new Date().toISOString()}`,
    '',
    `## ${input.labels.milestones}`,
    '',
  ];

  if (input.milestones.length === 0) {
    lines.push(input.labels.none, '');
  } else {
    for (const row of input.milestones) {
      const tone = deliveryScheduleTone({
        status: row.status,
        date: row.targetDate,
        today,
      });
      lines.push(
        `- **${row.title}** — ${row.status}` +
          (row.targetDate ? `, target ${row.targetDate}` : '') +
          ` (${tone})`,
      );
    }
    lines.push('');
  }

  lines.push(`## ${input.labels.tasks}`, '');
  if (input.tasks.length === 0) {
    lines.push(input.labels.none, '');
  } else {
    for (const row of input.tasks) {
      const tone = deliveryScheduleTone({
        status: row.status,
        date: row.dueDate,
        today,
      });
      const forecast = formatHours(row.forecastHours);
      const actual = formatHours(row.actualHours);
      const effortBits = [
        forecast != null
          ? `${input.labels.forecastHours}: ${forecast}`
          : null,
        actual != null ? `${input.labels.actualHours}: ${actual}` : null,
      ].filter(Boolean);
      lines.push(
        `- **${row.title}** — ${row.status}` +
          (row.dueDate ? `, due ${row.dueDate}` : '') +
          ` (${tone})` +
          (effortBits.length > 0 ? ` · ${effortBits.join(', ')}` : ''),
      );
    }
    lines.push('');
  }

  return `${lines.join('\n').trim()}\n`;
}

export function buildStakeholdersReport(input: {
  projectName: string;
  projectSlug: string;
  stakeholders: ReportStakeholder[];
  currency?: string;
  locale?: string;
  labels: {
    title: string;
    generated: string;
    people: string;
    aiAssistants: string;
    none: string;
    reportsTo: string;
    hourlyRate: string;
  };
}): string {
  const names = nameByUserId(input.stakeholders);
  const people = input.stakeholders.filter((row) => row.kind === 'person');
  const assistants = input.stakeholders.filter(
    (row) => row.kind === 'ai_assistant',
  );
  const currency = input.currency ?? 'EUR';
  const locale = input.locale ?? 'en';

  const lines = [
    `# ${input.labels.title}: ${input.projectName}`,
    '',
    `- Slug: \`${input.projectSlug}\``,
    `- ${input.labels.generated}: ${new Date().toISOString()}`,
    '',
    `## ${input.labels.people}`,
    '',
  ];

  if (people.length === 0) {
    lines.push(input.labels.none, '');
  } else {
    for (const row of people) {
      const reportsTo = row.reportsToUserId
        ? names.get(row.reportsToUserId)
        : null;
      const rate =
        row.hourlyRate != null && row.hourlyRate !== ''
          ? Number(row.hourlyRate)
          : null;
      const bits = [
        row.projectRole,
        row.jobTitle,
        row.email,
        row.raciRoles.length > 0 ? `RACI ${row.raciRoles.join('/')}` : null,
        reportsTo ? `${input.labels.reportsTo}: ${reportsTo}` : null,
        rate != null && Number.isFinite(rate)
          ? `${input.labels.hourlyRate}: ${formatMoney(rate, currency, locale)}`
          : null,
      ].filter(Boolean);
      lines.push(
        `- **${row.displayName}**${bits.length ? ` — ${bits.join(' · ')}` : ''}`,
      );
      if (row.notes) lines.push(`  - ${row.notes}`);
    }
    lines.push('');
  }

  lines.push(`## ${input.labels.aiAssistants}`, '');
  if (assistants.length === 0) {
    lines.push(input.labels.none, '');
  } else {
    for (const row of assistants) {
      const owner = row.reportsToUserId
        ? names.get(row.reportsToUserId)
        : null;
      lines.push(
        `- **${row.displayName}**` +
          (owner ? ` — ${input.labels.reportsTo}: ${owner}` : '') +
          (row.notes ? ` — ${row.notes}` : ''),
      );
    }
    lines.push('');
  }

  return `${lines.join('\n').trim()}\n`;
}

export function buildBudgetReportSection(input: {
  budget: ReportBudgetSummary | null;
  locale?: string;
  labels: {
    title: string;
    currency: string;
    initialBudget: string;
    approvedBudget: string;
    bac: string;
    ev: string;
    ac: string;
    pv: string;
    cpi: string;
    spi: string;
    financialRag: string;
    financialRagValue: string;
    none: string;
  };
}): string {
  const locale = input.locale ?? 'en';
  const lines = [`## ${input.labels.title}`, ''];

  if (!input.budget) {
    lines.push(input.labels.none, '');
    return lines.join('\n');
  }

  const b = input.budget;
  const currency = b.currency;
  lines.push(
    `- ${input.labels.currency}: ${currency}`,
    `- ${input.labels.initialBudget}: ${formatMoney(b.initialBudget, currency, locale)}`,
    `- ${input.labels.approvedBudget}: ${formatMoney(b.approvedBudget, currency, locale)}`,
    `- ${input.labels.bac}: ${formatMoney(b.bac, currency, locale)}`,
    `- ${input.labels.ev}: ${formatMoney(b.ev, currency, locale)}`,
    `- ${input.labels.ac}: ${formatMoney(b.ac, currency, locale)}`,
    `- ${input.labels.pv}: ${formatMoney(b.pv, currency, locale)}`,
    `- ${input.labels.cpi}: ${formatIndex(b.cpi)}`,
    `- ${input.labels.spi}: ${formatIndex(b.spi)}`,
    `- ${input.labels.financialRag}: **${input.labels.financialRagValue}**`,
    '',
  );
  return lines.join('\n');
}

export function buildRaidReportSection(input: {
  raidItems: ReportRaidItem[];
  riskRagValue: string;
  labels: {
    title: string;
    riskRag: string;
    none: string;
  };
  kindLabel: (kind: string) => string;
  statusLabel: (status: string) => string;
  severityLabel: (severity: string) => string;
}): string {
  const lines = [
    `## ${input.labels.title}`,
    '',
    `- ${input.labels.riskRag}: **${input.riskRagValue}**`,
    '',
  ];

  if (input.raidItems.length === 0) {
    lines.push(input.labels.none, '');
    return lines.join('\n');
  }

  for (const row of input.raidItems) {
    lines.push(
      `- **${row.title}** — ${input.kindLabel(row.kind)} · ${input.statusLabel(row.status)} · ${input.severityLabel(row.severity)}`,
    );
  }
  lines.push('');
  return lines.join('\n');
}

export function buildProjectStatusReport(input: {
  projectName: string;
  projectSlug: string;
  projectStatus: string;
  summary: string | null;
  milestones: ReportMilestone[];
  tasks: ReportTask[];
  stakeholders: ReportStakeholder[];
  raidItems: ReportRaidItem[];
  budget: ReportBudgetSummary | null;
  locale?: string;
  labels: {
    statusTitle: string;
    deliveryTitle: string;
    stakeholdersTitle: string;
    budgetTitle: string;
    raidTitle: string;
    generated: string;
    timelineRag: string;
    timelineRagValue: string;
    riskRag: string;
    riskRagValue: string;
    financialRag: string;
    financialRagValue: string;
    milestones: string;
    tasks: string;
    people: string;
    aiAssistants: string;
    none: string;
    reportsTo: string;
    hourlyRate: string;
    summary: string;
    forecastHours: string;
    actualHours: string;
    currency: string;
    initialBudget: string;
    approvedBudget: string;
    bac: string;
    ev: string;
    ac: string;
    pv: string;
    cpi: string;
    spi: string;
  };
  kindLabel: (kind: string) => string;
  statusLabel: (status: string) => string;
  severityLabel: (severity: string) => string;
}): string {
  const locale = input.locale ?? 'en';
  const currency = input.budget?.currency ?? 'EUR';

  const delivery = buildDeliveryStatusReport({
    projectName: input.projectName,
    projectSlug: input.projectSlug,
    projectStatus: input.projectStatus,
    milestones: input.milestones,
    tasks: input.tasks,
    labels: {
      title: input.labels.deliveryTitle,
      generated: input.labels.generated,
      timelineRag: input.labels.timelineRag,
      timelineRagValue: input.labels.timelineRagValue,
      milestones: input.labels.milestones,
      tasks: input.labels.tasks,
      none: input.labels.none,
      forecastHours: input.labels.forecastHours,
      actualHours: input.labels.actualHours,
    },
  });

  const stakeholders = buildStakeholdersReport({
    projectName: input.projectName,
    projectSlug: input.projectSlug,
    stakeholders: input.stakeholders,
    currency,
    locale,
    labels: {
      title: input.labels.stakeholdersTitle,
      generated: input.labels.generated,
      people: input.labels.people,
      aiAssistants: input.labels.aiAssistants,
      none: input.labels.none,
      reportsTo: input.labels.reportsTo,
      hourlyRate: input.labels.hourlyRate,
    },
  });

  const budgetSection = buildBudgetReportSection({
    budget: input.budget,
    locale,
    labels: {
      title: input.labels.budgetTitle,
      currency: input.labels.currency,
      initialBudget: input.labels.initialBudget,
      approvedBudget: input.labels.approvedBudget,
      bac: input.labels.bac,
      ev: input.labels.ev,
      ac: input.labels.ac,
      pv: input.labels.pv,
      cpi: input.labels.cpi,
      spi: input.labels.spi,
      financialRag: input.labels.financialRag,
      financialRagValue: input.labels.financialRagValue,
      none: input.labels.none,
    },
  });

  const raidSection = buildRaidReportSection({
    raidItems: input.raidItems,
    riskRagValue: input.labels.riskRagValue,
    labels: {
      title: input.labels.raidTitle,
      riskRag: input.labels.riskRag,
      none: input.labels.none,
    },
    kindLabel: input.kindLabel,
    statusLabel: input.statusLabel,
    severityLabel: input.severityLabel,
  });

  const header = [
    `# ${input.labels.statusTitle}: ${input.projectName}`,
    '',
    `- Slug: \`${input.projectSlug}\``,
    `- Status: ${input.projectStatus}`,
    `- ${input.labels.timelineRag}: **${input.labels.timelineRagValue}**`,
    `- ${input.labels.riskRag}: **${input.labels.riskRagValue}**`,
    `- ${input.labels.financialRag}: **${input.labels.financialRagValue}**`,
    `- ${input.labels.generated}: ${new Date().toISOString()}`,
    '',
  ];

  if (input.summary) {
    header.push(`## ${input.labels.summary}`, '', input.summary, '');
  }

  const deliveryBody = delivery.replace(/^# .*\n+/, '');
  const stakeholdersBody = stakeholders.replace(/^# .*\n+/, '');

  return (
    `${header.join('\n')}${budgetSection}\n${raidSection}\n${deliveryBody}\n${stakeholdersBody}`.trim() +
    '\n'
  );
}

export function downloadProjectReport(
  projectName: string,
  kind: 'delivery' | 'stakeholders' | 'status',
  markdown: string,
) {
  const stamp = todayYmd();
  downloadMarkdown(`${slugify(projectName)}-${kind}-${stamp}.md`, markdown);
}
