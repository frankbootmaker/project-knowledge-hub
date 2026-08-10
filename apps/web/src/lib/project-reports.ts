import {
  deliveryScheduleTone,
  projectDeliveryRag,
  todayYmd,
} from './delivery-schedule';

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
};

export type ReportStakeholder = {
  kind: string;
  displayName: string;
  email: string | null;
  projectRole: string | null;
  jobTitle: string | null;
  reportsToUserId: string | null;
  raciRoles: string[];
  notes: string | null;
  userId: string | null;
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

export async function fetchProjectReportData(projectId: string): Promise<{
  milestones: ReportMilestone[];
  tasks: ReportTask[];
  stakeholders: ReportStakeholder[];
}> {
  const [milestonesRes, tasksRes, stakeholdersRes] = await Promise.all([
    fetch(`/api/v1/projects/${projectId}/milestones`),
    fetch(`/api/v1/projects/${projectId}/tasks`),
    fetch(`/api/v1/projects/${projectId}/stakeholders`),
  ]);

  const milestones = milestonesRes.ok
    ? ((await milestonesRes.json()) as { milestones: ReportMilestone[] }).milestones
    : [];
  const tasks = tasksRes.ok
    ? ((await tasksRes.json()) as { tasks: ReportTask[] }).tasks
    : [];
  const stakeholders = stakeholdersRes.ok
    ? ((await stakeholdersRes.json()) as { stakeholders: ReportStakeholder[] })
        .stakeholders
    : [];

  return { milestones, tasks, stakeholders };
}

function nameByUserId(stakeholders: ReportStakeholder[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of stakeholders) {
    if (row.userId) map.set(row.userId, row.displayName);
  }
  return map;
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
    rag: string;
    ragValue: string;
    milestones: string;
    tasks: string;
    none: string;
  };
}): string {
  const today = todayYmd();
  const rag = projectDeliveryRag(
    [
      ...input.milestones.map((row) => ({
        status: row.status,
        date: row.targetDate,
      })),
      ...input.tasks.map((row) => ({ status: row.status, date: row.dueDate })),
    ],
    today,
  );

  const lines = [
    `# ${input.labels.title}: ${input.projectName}`,
    '',
    `- Slug: \`${input.projectSlug}\``,
    `- Status: ${input.projectStatus}`,
    `- ${input.labels.rag}: **${input.labels.ragValue || rag}**`,
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
      lines.push(
        `- **${row.title}** — ${row.status}` +
          (row.dueDate ? `, due ${row.dueDate}` : '') +
          ` (${tone})`,
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
  labels: {
    title: string;
    generated: string;
    people: string;
    aiAssistants: string;
    none: string;
    reportsTo: string;
  };
}): string {
  const names = nameByUserId(input.stakeholders);
  const people = input.stakeholders.filter((row) => row.kind === 'person');
  const assistants = input.stakeholders.filter((row) => row.kind === 'ai_assistant');

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
      const bits = [
        row.projectRole,
        row.jobTitle,
        row.email,
        row.raciRoles.length > 0 ? `RACI ${row.raciRoles.join('/')}` : null,
        reportsTo ? `${input.labels.reportsTo}: ${reportsTo}` : null,
      ].filter(Boolean);
      lines.push(`- **${row.displayName}**${bits.length ? ` — ${bits.join(' · ')}` : ''}`);
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

export function buildProjectStatusReport(input: {
  projectName: string;
  projectSlug: string;
  projectStatus: string;
  summary: string | null;
  milestones: ReportMilestone[];
  tasks: ReportTask[];
  stakeholders: ReportStakeholder[];
  labels: {
    statusTitle: string;
    deliveryTitle: string;
    stakeholdersTitle: string;
    generated: string;
    rag: string;
    ragValue: string;
    milestones: string;
    tasks: string;
    people: string;
    aiAssistants: string;
    none: string;
    reportsTo: string;
    summary: string;
  };
}): string {
  const delivery = buildDeliveryStatusReport({
    projectName: input.projectName,
    projectSlug: input.projectSlug,
    projectStatus: input.projectStatus,
    milestones: input.milestones,
    tasks: input.tasks,
    labels: {
      title: input.labels.deliveryTitle,
      generated: input.labels.generated,
      rag: input.labels.rag,
      ragValue: input.labels.ragValue,
      milestones: input.labels.milestones,
      tasks: input.labels.tasks,
      none: input.labels.none,
    },
  });

  const stakeholders = buildStakeholdersReport({
    projectName: input.projectName,
    projectSlug: input.projectSlug,
    stakeholders: input.stakeholders,
    labels: {
      title: input.labels.stakeholdersTitle,
      generated: input.labels.generated,
      people: input.labels.people,
      aiAssistants: input.labels.aiAssistants,
      none: input.labels.none,
      reportsTo: input.labels.reportsTo,
    },
  });

  const header = [
    `# ${input.labels.statusTitle}: ${input.projectName}`,
    '',
    `- Slug: \`${input.projectSlug}\``,
    `- Status: ${input.projectStatus}`,
    `- ${input.labels.rag}: **${input.labels.ragValue}**`,
    `- ${input.labels.generated}: ${new Date().toISOString()}`,
    '',
  ];

  if (input.summary) {
    header.push(`## ${input.labels.summary}`, '', input.summary, '');
  }

  // Drop duplicate H1s from sub-reports; keep their ## sections.
  const deliveryBody = delivery.replace(/^# .*\n+/, '');
  const stakeholdersBody = stakeholders.replace(/^# .*\n+/, '');

  return `${header.join('\n')}${deliveryBody}\n${stakeholdersBody}`.trim() + '\n';
}

export function downloadProjectReport(
  projectName: string,
  kind: 'delivery' | 'stakeholders' | 'status',
  markdown: string,
) {
  const stamp = todayYmd();
  downloadMarkdown(`${slugify(projectName)}-${kind}-${stamp}.md`, markdown);
}
