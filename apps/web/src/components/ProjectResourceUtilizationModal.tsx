'use client';

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import { Badge, ErrorText } from './ui';

type UtilizationView = 'planned' | 'burn' | 'combined';
type UtilizationStatus = 'under' | 'on_track' | 'over' | 'unknown';
type ResourceRag = 'green' | 'amber' | 'red';

type PersonRow = {
  userId: string;
  displayName: string;
  engagementType: 'employee' | 'contractor' | null;
  capacityHours: number | null;
  plannedHours: number;
  burnHours: number;
  plannedPct: number | null;
  burnPct: number | null;
  combinedPct: number | null;
  status: UtilizationStatus;
  windowStart: string | null;
  windowEnd: string | null;
  allocatedDailyHours: number | null;
};

type UtilizationPayload = {
  view: UtilizationView;
  resourceRag: ResourceRag;
  people: PersonRow[];
  totals: {
    capacityHours: number;
    plannedHours: number;
    burnHours: number;
  };
};

const VIEWS: UtilizationView[] = ['planned', 'burn', 'combined'];

function statusTone(
  status: UtilizationStatus,
): 'brand' | 'success' | 'danger' | 'neutral' {
  if (status === 'under') return 'brand';
  if (status === 'on_track') return 'success';
  if (status === 'over') return 'danger';
  return 'neutral';
}

function ragTone(rag: ResourceRag): 'success' | 'warn' | 'danger' {
  if (rag === 'red') return 'danger';
  if (rag === 'amber') return 'warn';
  return 'success';
}

function formatHours(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${value.toFixed(1)}h`;
}

function formatPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${value.toFixed(0)}%`;
}

function demandForView(row: PersonRow, view: UtilizationView): number {
  if (view === 'burn') return row.burnHours;
  if (view === 'combined') return Math.max(row.plannedHours, row.burnHours);
  return row.plannedHours;
}

function pctForView(row: PersonRow, view: UtilizationView): number | null {
  if (view === 'burn') return row.burnPct;
  if (view === 'combined') return row.combinedPct;
  return row.plannedPct;
}

function CapacityRows({
  people,
  view,
}: {
  people: PersonRow[];
  view: UtilizationView;
}) {
  const t = useTranslations('utilization');
  const max = useMemo(() => {
    let peak = 1;
    for (const row of people) {
      peak = Math.max(
        peak,
        row.capacityHours ?? 0,
        row.plannedHours,
        row.burnHours,
        demandForView(row, view),
      );
    }
    return peak;
  }, [people, view]);

  if (people.length === 0) return null;

  return (
    <div className="kh-ops-panel">
      {people.map((row) => {
        const plannedPct = Math.min(100, (row.plannedHours / max) * 100);
        const burnPct = Math.min(100, (row.burnHours / max) * 100);
        const singleDemand = demandForView(row, view);
        const singlePct = Math.min(100, (singleDemand / max) * 100);
        const plannedWidth = view === 'burn' ? 0 : view === 'combined' ? plannedPct : singlePct;
        const burnWidth = view === 'planned' ? 0 : view === 'combined' ? burnPct : singlePct;
        return (
          <div key={row.userId} className="kh-ops-capacity-row">
            <div className="kh-ops-capacity-name">
              <strong>{row.displayName}</strong>
              <small>
                {formatHours(row.capacityHours)}
                {row.engagementType
                  ? ` · ${t(`engagement.${row.engagementType}`)}`
                  : ''}
              </small>
            </div>
            <div
              className="kh-ops-capacity-track"
              style={
                {
                  '--planned': `${plannedWidth}%`,
                  '--burn': `${burnWidth}%`,
                } as CSSProperties
              }
            >
              <i />
              <b />
            </div>
            <span className="kh-ops-capacity-hours">
              {formatHours(demandForView(row, view))}
            </span>
            <Badge tone={statusTone(row.status)}>
              {t(`status.${row.status}`)}
            </Badge>
          </div>
        );
      })}
    </div>
  );
}

export function ProjectResourceUtilizationView({
  projectId,
  active,
}: {
  projectId: string;
  active: boolean;
}) {
  const t = useTranslations('utilization');
  const tCommon = useTranslations('common');
  const tProjects = useTranslations('projects');
  const [view, setView] = useState<UtilizationView>('combined');
  const [data, setData] = useState<UtilizationPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!active) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/v1/projects/${projectId}/resource-utilization?view=${view}`,
      );
      if (!response.ok) {
        throw new Error(t('failedLoad'));
      }
      const payload = (await response.json()) as {
        utilization?: UtilizationPayload;
      };
      if (!payload.utilization) throw new Error(t('failedLoad'));
      setData(payload.utilization);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('failedLoad'));
    } finally {
      setLoading(false);
    }
  }, [active, projectId, view, t]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!active) return null;

  return (
    <div className="grid gap-3">
      <div className="kh-ops-toolbar">
        <div
          className="kh-ops-delivery-modes mb-0"
          role="group"
          aria-label={t('viewLabel')}
        >
          {VIEWS.map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={view === mode}
              onClick={() => setView(mode)}
            >
              {t(`view.${mode}`)}
            </button>
          ))}
        </div>
        {data ? (
          <Badge tone={ragTone(data.resourceRag)}>
            {t('resourceRag')}: {tProjects(`rag.${data.resourceRag}`)}
          </Badge>
        ) : null}
      </div>

      {error ? <ErrorText>{error}</ErrorText> : null}
      {loading && !data ? (
        <p className="m-0 text-sm text-ink-muted">{tCommon('loading')}</p>
      ) : null}

      {data && data.resourceRag !== 'green' ? (
        <p className="m-0 rounded-[3px] border border-warn/40 bg-warn-soft px-3 py-2 text-xs text-ink">
          {t('atRiskCallout')}
        </p>
      ) : null}

      {data ? (
        <>
          <div className="kh-ops-stats">
            <article className="kh-ops-stat">
              <div className="kh-ops-stat-label">{t('capacity')}</div>
              <div className="kh-ops-stat-value">
                {formatHours(data.totals.capacityHours)}
              </div>
            </article>
            <article className="kh-ops-stat">
              <div className="kh-ops-stat-label">{t('plannedDemand')}</div>
              <div className="kh-ops-stat-value">
                {formatHours(data.totals.plannedHours)}
              </div>
            </article>
            <article className="kh-ops-stat">
              <div className="kh-ops-stat-label">{t('burnDemand')}</div>
              <div className="kh-ops-stat-value">
                {formatHours(data.totals.burnHours)}
              </div>
            </article>
          </div>

          {data.people.length === 0 ? (
            <div className="kh-ops-empty-state">
              <div className="kh-ops-empty-mark">00</div>
              <h3>{t('title')}</h3>
              <p>{t('empty')}</p>
            </div>
          ) : (
            <CapacityRows people={data.people} view={view} />
          )}

          {data.people.length > 0 ? (
            <section className="kh-ops-panel">
              <div className="kh-ops-table-wrap">
                <table className="kh-ops-data-table">
                  <thead>
                    <tr>
                      <th>{t('person')}</th>
                      <th>{t('capacity')}</th>
                      <th>{t('demand')}</th>
                      <th>{t('pct')}</th>
                      <th>{t('statusLabel')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.people.map((row) => (
                      <tr key={row.userId}>
                        <td className="kh-ops-primary-cell">
                          {row.displayName}
                          <div className="text-[11px] font-normal text-ink-muted">
                            {row.engagementType
                              ? t(`engagement.${row.engagementType}`)
                              : t('engagement.unset')}
                            {row.windowStart && row.windowEnd
                              ? ` · ${row.windowStart} → ${row.windowEnd}`
                              : ''}
                          </div>
                        </td>
                        <td>{formatHours(row.capacityHours)}</td>
                        <td>{formatHours(demandForView(row, view))}</td>
                        <td>{formatPct(pctForView(row, view))}</td>
                        <td>
                          <Badge tone={statusTone(row.status)}>
                            {t(`status.${row.status}`)}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
