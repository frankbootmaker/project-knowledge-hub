'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Badge,
  Button,
  ErrorText,
  Modal,
} from './ui';
import { cn } from '../lib/cn';

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

function CapacityBars({
  people,
  view,
}: {
  people: PersonRow[];
  view: UtilizationView;
}) {
  const max = useMemo(() => {
    let peak = 1;
    for (const row of people) {
      peak = Math.max(peak, row.capacityHours ?? 0, demandForView(row, view));
    }
    return peak;
  }, [people, view]);

  if (people.length === 0) return null;

  return (
    <div className="grid gap-3" aria-hidden>
      {people.map((row) => {
        const capacity = row.capacityHours ?? 0;
        const demand = demandForView(row, view);
        const capacityPct = Math.min(100, (capacity / max) * 100);
        const demandPct = Math.min(100, (demand / max) * 100);
        const over = demand > capacity && capacity > 0;
        return (
          <div key={row.userId} className="grid gap-1">
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="truncate font-medium text-ink">
                {row.displayName}
              </span>
              <span className="shrink-0 text-ink-muted">
                {formatHours(demand)} / {formatHours(row.capacityHours)}
              </span>
            </div>
            <div className="relative h-3 overflow-hidden rounded-sm bg-neutral-soft">
              <div
                className="absolute inset-y-0 left-0 bg-line"
                style={{ width: `${capacityPct}%` }}
              />
              <div
                className={cn(
                  'absolute inset-y-0 left-0',
                  over ? 'bg-danger/80' : 'bg-brand/70',
                )}
                style={{ width: `${demandPct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function ProjectResourceUtilizationModal({
  open,
  onClose,
  projectId,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
}) {
  const t = useTranslations('utilization');
  const tCommon = useTranslations('common');
  const tProjects = useTranslations('projects');
  const [view, setView] = useState<UtilizationView>('planned');
  const [data, setData] = useState<UtilizationPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!open) return;
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
  }, [open, projectId, view, t]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('title')}
      description={t('description')}
      size="xl"
      bodyClassName="!block overflow-auto"
      footer={
        <Button type="button" variant="secondary" onClick={onClose}>
          {tCommon('close')}
        </Button>
      }
    >
      <div className="grid gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div
            className="inline-flex max-w-full overflow-x-auto rounded-md border border-line p-0.5"
            role="group"
            aria-label={t('viewLabel')}
          >
            {VIEWS.map((mode) => (
              <Button
                key={mode}
                type="button"
                variant={view === mode ? 'primary' : 'secondary'}
                className={cn(
                  'h-8 shrink-0 rounded-sm px-2 text-xs sm:px-2.5',
                  view === mode
                    ? ''
                    : 'border-transparent bg-transparent shadow-none',
                )}
                aria-pressed={view === mode}
                onClick={() => setView(mode)}
              >
                {t(`view.${mode}`)}
              </Button>
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
          <p className="m-0 rounded-md border border-warn/40 bg-warn-soft px-3 py-2 text-sm text-ink">
            {t('atRiskCallout')}
          </p>
        ) : null}

        {data ? (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-md border border-line bg-panel-solid p-3">
                <p className="m-0 text-xs uppercase tracking-wide text-ink-muted">
                  {t('capacity')}
                </p>
                <p className="mt-1 mb-0 text-lg font-semibold">
                  {formatHours(data.totals.capacityHours)}
                </p>
              </div>
              <div className="rounded-md border border-line bg-panel-solid p-3">
                <p className="m-0 text-xs uppercase tracking-wide text-ink-muted">
                  {t('plannedDemand')}
                </p>
                <p className="mt-1 mb-0 text-lg font-semibold">
                  {formatHours(data.totals.plannedHours)}
                </p>
              </div>
              <div className="rounded-md border border-line bg-panel-solid p-3">
                <p className="m-0 text-xs uppercase tracking-wide text-ink-muted">
                  {t('burnDemand')}
                </p>
                <p className="mt-1 mb-0 text-lg font-semibold">
                  {formatHours(data.totals.burnHours)}
                </p>
              </div>
            </div>

            <div>
              <p className="mt-0 mb-2 text-xs font-medium uppercase tracking-wide text-ink-muted">
                {t('diagram')}
              </p>
              {data.people.length === 0 ? (
                <p className="m-0 text-sm text-ink-muted">{t('empty')}</p>
              ) : (
                <CapacityBars people={data.people} view={view} />
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-muted">
                    <th className="py-2 pr-3 font-medium">{t('person')}</th>
                    <th className="py-2 pr-3 font-medium">{t('capacity')}</th>
                    <th className="py-2 pr-3 font-medium">{t('demand')}</th>
                    <th className="py-2 pr-3 font-medium">{t('pct')}</th>
                    <th className="py-2 font-medium">{t('statusLabel')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.people.map((row) => (
                    <tr key={row.userId} className="border-b border-line/70">
                      <td className="py-2 pr-3">
                        <div className="font-medium text-ink">
                          {row.displayName}
                        </div>
                        <div className="text-xs text-ink-muted">
                          {row.engagementType
                            ? t(`engagement.${row.engagementType}`)
                            : t('engagement.unset')}
                          {row.windowStart && row.windowEnd
                            ? ` · ${row.windowStart} → ${row.windowEnd}`
                            : ''}
                        </div>
                      </td>
                      <td className="py-2 pr-3 text-ink-muted">
                        {formatHours(row.capacityHours)}
                      </td>
                      <td className="py-2 pr-3 text-ink-muted">
                        {formatHours(demandForView(row, view))}
                      </td>
                      <td className="py-2 pr-3 text-ink-muted">
                        {formatPct(pctForView(row, view))}
                      </td>
                      <td className="py-2">
                        <Badge tone={statusTone(row.status)}>
                          {t(`status.${row.status}`)}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </div>
    </Modal>
  );
}
