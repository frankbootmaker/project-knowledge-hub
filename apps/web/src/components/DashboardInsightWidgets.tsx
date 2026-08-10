import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { DashboardWidgetPrefs } from '@project-knowledge-hub/domain';
import type { DashboardInsights } from '../lib/dashboard';
import { Panel } from './ui';

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
  const barClass =
    tone === 'danger'
      ? 'bg-danger'
      : tone === 'warn'
        ? 'bg-amber-500'
        : tone === 'ok'
          ? 'bg-emerald-500'
          : tone === 'brand'
            ? 'bg-brand'
            : 'bg-ink-muted/40';

  return (
    <div className="grid gap-1">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-ink-muted">{label}</span>
        <span className="font-semibold text-ink">{value}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-line">
        <div className={`h-full rounded-full ${barClass}`} style={{ width: `${width}%` }} />
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
    <section className="mb-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {prefs.tasksByDue ? (
        <Panel className="grid gap-3">
          <h2 className="m-0 text-sm font-semibold">{t('widgetTasksByDue')}</h2>
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
        </Panel>
      ) : null}

      {prefs.projectHealthRag ? (
        <Panel className="grid gap-3">
          <h2 className="m-0 text-sm font-semibold">{t('widgetProjectHealth')}</h2>
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
        </Panel>
      ) : null}

      {prefs.openRaidCounts ? (
        <Panel className="grid gap-3">
          <h2 className="m-0 text-sm font-semibold">{t('widgetOpenRaid')}</h2>
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
        </Panel>
      ) : null}

      {prefs.budgetAttention ? (
        <Panel className="grid gap-3">
          <h2 className="m-0 text-sm font-semibold">{t('widgetBudgetAttention')}</h2>
          {insights.budgetAttention.length === 0 ? (
            <p className="m-0 text-sm text-ink-muted">{t('widgetBudgetClear')}</p>
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
                  <p className="m-0 text-xs text-ink-muted">
                    CPI {row.cpi?.toFixed(2) ?? '—'} · SPI{' '}
                    {row.spi?.toFixed(2) ?? '—'} · {t(`rag.${row.financialRag}`)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      ) : null}
    </section>
  );
}
