import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { DashboardWidgetPrefs } from '@project-knowledge-hub/domain';
import type { DashboardInsights } from '../lib/dashboard';
import { cn } from '../lib/cn';

function BarRow({
  label,
  value,
  total,
  tone,
}: {
  label: string;
  value: number;
  total: number;
  tone: 'danger' | 'warn' | 'ok' | 'muted' | 'brand';
}) {
  const width = total > 0 ? Math.max(4, Math.round((value / total) * 100)) : 0;
  const progressClass =
    tone === 'danger'
      ? 'kh-ops-progress-danger'
      : tone === 'warn'
        ? 'kh-ops-progress-warn'
        : tone === 'muted'
          ? 'kh-ops-progress-muted'
          : '';

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-[11px]">
        <span className="text-ink-muted">{label}</span>
        <span className="font-semibold tabular-nums text-ink">{value}</span>
      </div>
      <div className={cn('kh-ops-progress', progressClass)}>
        <span style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

export async function DashboardInsightWidgets({
  insights,
  prefs,
}: {
  insights: DashboardInsights;
  prefs: DashboardWidgetPrefs;
}) {
  const t = await getTranslations('dashboard');
  const showAny =
    prefs.tasksByDue ||
    prefs.projectHealthRag ||
    prefs.openRaidCounts ||
    prefs.budgetAttention;
  if (!showAny) return null;

  const taskTotal =
    insights.tasksByDue.overdue +
    insights.tasksByDue.dueSoon +
    insights.tasksByDue.later +
    insights.tasksByDue.none;
  const ragTotal =
    insights.projectHealthRag.green +
    insights.projectHealthRag.amber +
    insights.projectHealthRag.red;
  const raidTotal = Math.max(insights.openRaid.total, 1);

  return (
    <section className="kh-ops-stats mb-4">
      {prefs.tasksByDue ? (
        <div className="kh-ops-stat grid gap-2">
          <p className="kh-ops-stat-label m-0">{t('widgetTasksByDue')}</p>
          <BarRow
            label={t('widgetOverdue')}
            value={insights.tasksByDue.overdue}
            total={taskTotal}
            tone="danger"
          />
          <BarRow
            label={t('widgetDueSoon')}
            value={insights.tasksByDue.dueSoon}
            total={taskTotal}
            tone="warn"
          />
          <BarRow
            label={t('widgetLater')}
            value={insights.tasksByDue.later}
            total={taskTotal}
            tone="ok"
          />
          <BarRow
            label={t('widgetNoDue')}
            value={insights.tasksByDue.none}
            total={taskTotal}
            tone="muted"
          />
        </div>
      ) : null}

      {prefs.projectHealthRag ? (
        <div className="kh-ops-stat grid gap-2">
          <p className="kh-ops-stat-label m-0">{t('widgetProjectHealth')}</p>
          <BarRow
            label={t('widgetRagGreen')}
            value={insights.projectHealthRag.green}
            total={ragTotal}
            tone="ok"
          />
          <BarRow
            label={t('widgetRagAmber')}
            value={insights.projectHealthRag.amber}
            total={ragTotal}
            tone="warn"
          />
          <BarRow
            label={t('widgetRagRed')}
            value={insights.projectHealthRag.red}
            total={ragTotal}
            tone="danger"
          />
        </div>
      ) : null}

      {prefs.openRaidCounts ? (
        <div className="kh-ops-stat grid gap-2">
          <p className="kh-ops-stat-label m-0">{t('widgetOpenRaid')}</p>
          <BarRow
            label={t('widgetRisks')}
            value={insights.openRaid.risks}
            total={raidTotal}
            tone="danger"
          />
          <BarRow
            label={t('widgetIssues')}
            value={insights.openRaid.issues}
            total={raidTotal}
            tone="warn"
          />
          <BarRow
            label={t('widgetAssumptions')}
            value={insights.openRaid.assumptions}
            total={raidTotal}
            tone="brand"
          />
          <BarRow
            label={t('widgetDependencies')}
            value={insights.openRaid.dependencies}
            total={raidTotal}
            tone="muted"
          />
        </div>
      ) : null}

      {prefs.budgetAttention ? (
        <div className="kh-ops-stat grid gap-2">
          <p className="kh-ops-stat-label m-0">{t('widgetBudgetAttention')}</p>
          {insights.budgetAttention.length === 0 ? (
            <p className="kh-ops-stat-note m-0">{t('widgetBudgetClear')}</p>
          ) : (
            <ul className="m-0 grid list-none gap-2 p-0">
              {insights.budgetAttention.map((row) => (
                <li key={row.projectId}>
                  <Link
                    href={`/workspaces/${row.workspaceSlug}/projects/${row.projectSlug}`}
                    className="kh-text-link text-sm font-medium"
                  >
                    {row.projectName}
                  </Link>
                  <p className="m-0 text-[11px] text-ink-muted">
                    CPI {row.cpi?.toFixed(2) ?? '—'} · SPI{' '}
                    {row.spi?.toFixed(2) ?? '—'} · {t(`rag.${row.financialRag}`)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}
