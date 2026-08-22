'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { CollapsibleSection } from './CollapsibleSection';
import { formatMoney, parseOptionalNumber } from '../lib/project-currency';
import {
  Button,
  ErrorText,
  Field,
  Input,
  Modal,
  useToast,
} from './ui';

type CostSnapshotPoint = {
  capturedOn: string;
  bac: number;
  pv: number | null;
  ev: number;
  ac: number;
};

type EpicBudgetRollup = {
  epicId: string;
  title: string;
  forecastHours: number;
  actualHours: number;
  forecastCost: number | null;
  actualCost: number | null;
};

type AiBudgetBreakdown = {
  systemId: string;
  name: string;
  costMode: 'flat' | 'api' | 'mixed' | 'note_only' | null;
  flatAccruedCost: number;
  tokenCost: number;
  noteOnlyTokens: number;
  billableCost: number;
  budgetAllocation: number | null;
  overAllocation: boolean;
};

type SystemItBudgetBreakdown = {
  systemId: string;
  name: string;
  costMode: 'flat' | 'one_time' | 'note_only' | null;
  flatAccruedCost: number;
  oneTimeCost: number;
  billableCost: number;
  budgetAllocation: number | null;
  overAllocation: boolean;
};

export type ProjectBudgetSummary = {
  currency: string;
  initialBudget: number | null;
  approvedBudget: number | null;
  bac: number | null;
  pv: number | null;
  ev: number;
  ac: number;
  personAc: number;
  aiAc: number;
  systemAc: number;
  aiNoteOnlyTokens: number;
  aiSystems: AiBudgetBreakdown[];
  itSystems: SystemItBudgetBreakdown[];
  cpi: number | null;
  spi: number | null;
  financialRag: 'red' | 'amber' | 'green';
  riskRag: 'red' | 'amber' | 'green';
  startDate: string | null;
  endDate: string | null;
  burndown: CostSnapshotPoint[];
  epics: EpicBudgetRollup[];
};

function formatIndex(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toFixed(2);
}

function BurndownChart({
  bac,
  startDate,
  endDate,
  burndown,
  variant = 'inline',
}: {
  bac: number | null;
  startDate: string | null;
  endDate: string | null;
  burndown: CostSnapshotPoint[];
  /** Wider canvas for mobile landscape / modal viewing. */
  variant?: 'inline' | 'landscape';
}) {
  const t = useTranslations('budget');
  const width = variant === 'landscape' ? 960 : 560;
  const height = variant === 'landscape' ? 420 : 180;
  const pad = { top: 12, right: 12, bottom: 28, left: 44 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;

  const points = useMemo(() => {
    if (bac == null || bac <= 0 || !startDate || !endDate) return null;
    const start = Date.parse(`${startDate}T00:00:00Z`);
    const end = Date.parse(`${endDate}T00:00:00Z`);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      return null;
    }
    const xFor = (ymd: string) => {
      const tMs = Date.parse(`${ymd}T00:00:00Z`);
      const ratio = Math.min(1, Math.max(0, (tMs - start) / (end - start)));
      return pad.left + ratio * innerW;
    };
    const yFor = (remaining: number) =>
      pad.top + (1 - Math.min(1, Math.max(0, remaining / bac))) * innerH;

    const ideal = [
      { x: pad.left, y: yFor(bac) },
      { x: pad.left + innerW, y: yFor(0) },
    ];
    const actual = burndown
      .slice()
      .sort((a, b) => a.capturedOn.localeCompare(b.capturedOn))
      .map((row) => ({
        x: xFor(row.capturedOn),
        y: yFor(Math.max(0, bac - row.ac)),
      }));
    return { ideal, actual, bac };
  }, [bac, startDate, endDate, burndown, innerH, innerW, pad.left, pad.top]);

  if (!points) {
    return (
      <p className="m-0 text-sm text-ink-muted">{t('burndownEmpty')}</p>
    );
  }

  const idealPath = `M ${points.ideal[0]!.x} ${points.ideal[0]!.y} L ${points.ideal[1]!.x} ${points.ideal[1]!.y}`;
  const actualPath =
    points.actual.length > 0
      ? points.actual
          .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
          .join(' ')
      : null;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={
        variant === 'landscape'
          ? 'mx-auto h-auto w-full min-h-[14rem] max-h-[min(70dvh,28rem)]'
          : 'h-auto w-full max-w-full'
      }
      role="img"
      aria-label={t('burndownAria')}
    >
      <line
        x1={pad.left}
        y1={pad.top}
        x2={pad.left}
        y2={pad.top + innerH}
        stroke="currentColor"
        className="text-line"
      />
      <line
        x1={pad.left}
        y1={pad.top + innerH}
        x2={pad.left + innerW}
        y2={pad.top + innerH}
        stroke="currentColor"
        className="text-line"
      />
      <text
        x={4}
        y={pad.top + 8}
        className="fill-ink-muted text-[10px]"
      >
        {points.bac.toFixed(0)}
      </text>
      <text
        x={4}
        y={pad.top + innerH}
        className="fill-ink-muted text-[10px]"
      >
        0
      </text>
      <path
        d={idealPath}
        fill="none"
        stroke="currentColor"
        strokeDasharray="4 4"
        className="text-ink-muted"
        strokeWidth={1.5}
      />
      {actualPath ? (
        <path
          d={actualPath}
          fill="none"
          stroke="currentColor"
          className="text-brand"
          strokeWidth={2}
        />
      ) : null}
      {points.actual.map((p) => (
        <circle
          key={`${p.x}-${p.y}`}
          cx={p.x}
          cy={p.y}
          r={3}
          className="fill-brand"
        />
      ))}
      <text
        x={pad.left}
        y={height - 8}
        className="fill-ink-muted text-[10px]"
      >
        {startDate}
      </text>
      <text
        x={pad.left + innerW}
        y={height - 8}
        textAnchor="end"
        className="fill-ink-muted text-[10px]"
      >
        {endDate}
      </text>
    </svg>
  );
}

export function ProjectBudgetPanel({
  projectId,
  canMutate,
  initialSummary = null,
}: {
  projectId: string;
  canMutate: boolean;
  initialSummary?: ProjectBudgetSummary | null;
}) {
  const t = useTranslations('budget');
  const tStakeholders = useTranslations('stakeholders');
  const tSystems = useTranslations('systems');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const { pushToast } = useToast();

  const [summary, setSummary] = useState<ProjectBudgetSummary | null>(
    initialSummary,
  );
  const [approvedBudget, setApprovedBudget] = useState(
    initialSummary?.approvedBudget != null
      ? String(initialSummary.approvedBudget)
      : '',
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [burndownOpen, setBurndownOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/v1/projects/${projectId}/budget-summary`,
      );
      const payload = (await response.json().catch(() => ({}))) as {
        budget?: ProjectBudgetSummary;
        error?: { message?: string };
      };
      if (!response.ok || !payload.budget) {
        throw new Error(payload.error?.message || t('failedLoad'));
      }
      setError(null);
      setSummary(payload.budget);
      setApprovedBudget(
        payload.budget.approvedBudget != null
          ? String(payload.budget.approvedBudget)
          : '',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : t('failedLoad'));
    }
    // t is locale-stable for this panel; omitting it avoids a refetch loop.
  }, [projectId]);

  useEffect(() => {
    setSummary(initialSummary);
    setApprovedBudget(
      initialSummary?.approvedBudget != null
        ? String(initialSummary.approvedBudget)
        : '',
    );
  }, [initialSummary]);

  useEffect(() => {
    if (!initialSummary) {
      void load();
    }
  }, [initialSummary, load]);

  async function saveApproved() {
    if (!canMutate || pending) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/projects/${projectId}/budget`, {
        method: 'PATCH',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Origin: window.location.origin,
        },
        body: JSON.stringify({
          approvedBudget: parseOptionalNumber(approvedBudget) ?? null,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        budget?: ProjectBudgetSummary;
        error?: { message?: string };
      };
      if (!response.ok || !payload.budget) {
        throw new Error(payload.error?.message || t('failedUpdate'));
      }
      setSummary(payload.budget);
      pushToast(t('updated'), 'success');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('failedUpdate'));
    } finally {
      setPending(false);
    }
  }

  const currency = summary?.currency ?? 'EUR';

  return (
    <>
    <CollapsibleSection
      id="project-budget"
      storageKey={`project:${projectId}:budget`}
      title={t('title')}
      defaultOpen
    >
      {error ? (
        <div className="mb-3">
          <ErrorText>{error}</ErrorText>
        </div>
      ) : null}

      {!summary && !error ? (
        <p className="m-0 text-sm text-ink-muted">{tCommon('loading')}</p>
      ) : null}

      {summary ? (
        <div className="grid gap-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
            <Field label={t('approvedBudget')} className="w-full max-w-xs">
              <Input
                type="number"
                min="0"
                step="0.01"
                value={approvedBudget}
                onChange={(e) => setApprovedBudget(e.target.value)}
                disabled={!canMutate || pending}
              />
            </Field>
            {canMutate ? (
              <Button
                type="button"
                className="w-fit shrink-0 self-start sm:self-auto"
                disabled={pending}
                onClick={() => void saveApproved()}
              >
                {pending ? tCommon('saving') : t('saveApproved')}
              </Button>
            ) : null}
          </div>

          <div className="kh-ops-stats">
            {(
              [
                ['bac', summary.bac],
                ['ev', summary.ev],
                ['ac', summary.ac],
              ] as const
            ).map(([key, value]) => (
              <div key={key} className="kh-ops-stat">
                <p className="kh-ops-stat-label m-0">{t(`kpi.${key}`)}</p>
                <p className="kh-ops-stat-value">
                  {formatMoney(value, currency, locale)}
                </p>
              </div>
            ))}
            <div className="kh-ops-stat">
              <p className="kh-ops-stat-label m-0">{t('kpi.cpi')}</p>
              <p className="kh-ops-stat-value">{formatIndex(summary.cpi)}</p>
            </div>
            <div className="kh-ops-stat">
              <p className="kh-ops-stat-label m-0">{t('kpi.spi')}</p>
              <p className="kh-ops-stat-value">{formatIndex(summary.spi)}</p>
            </div>
          </div>

          <div className="kh-ops-budget-layout">
            <section className="kh-ops-panel">
              <div className="kh-ops-panel-head">
                <h2 className="kh-ops-panel-title">{t('burndown')}</h2>
              </div>
              <div className="kh-ops-chart-wrap">
                <div className="kh-ops-chart-legend">
                  <span>
                    <i style={{ background: 'var(--kh-ink)' }} />
                    {t('kpi.ev')}
                  </span>
                  <span>
                    <i style={{ background: 'var(--kh-accent)' }} />
                    {t('kpi.ac')}
                  </span>
                </div>
                <p className="mt-0 mb-2 text-[11px] text-ink-muted">
                  {t('burndownLegend')}
                </p>
                <div className="hidden md:block">
                  <BurndownChart
                    bac={summary.bac}
                    startDate={summary.startDate}
                    endDate={summary.endDate}
                    burndown={summary.burndown}
                  />
                </div>
                <div className="md:hidden">
                  <Button
                    type="button"
                    variant="secondary"
                    className="w-fit"
                    onClick={() => setBurndownOpen(true)}
                  >
                    {t('burndownOpen')}
                  </Button>
                  <p className="mt-2 mb-0 text-xs text-ink-muted">
                    {t('burndownLandscapeHint')}
                  </p>
                </div>
              </div>
            </section>

            <section className="kh-ops-panel">
              <div className="kh-ops-panel-head">
                <h2 className="kh-ops-panel-title">{t('costSplit')}</h2>
              </div>
              <div className="kh-ops-cost-split">
                {(
                  [
                    ['people', summary.personAc ?? summary.ac, t('costSplitPeople')],
                    ['ai', summary.aiAc ?? 0, t('costSplitAi')],
                    ['systems', summary.systemAc ?? 0, t('costSplitSystems')],
                  ] as const
                ).map(([key, value, label]) => {
                  const total = summary.ac || 1;
                  const width = Math.min(100, Math.max(0, (value / total) * 100));
                  return (
                    <div key={key} className="kh-ops-cost-part">
                      <small>{label}</small>
                      <strong>{formatMoney(value, currency, locale)}</strong>
                      <i style={{ width: `${width}%` }} />
                    </div>
                  );
                })}
              </div>
              <div className="kh-ops-card-body grid gap-1 text-[11px] text-ink-muted">
                {(summary.aiNoteOnlyTokens ?? 0) > 0 ? (
                  <p className="m-0">
                    {t('aiNoteOnlyTokens', { count: summary.aiNoteOnlyTokens })}
                  </p>
                ) : null}
                {(summary.aiSystems ?? []).some((system) => system.overAllocation) ? (
                  <p className="m-0 text-warn">{t('aiOverAllocation')}</p>
                ) : null}
                {(summary.itSystems ?? []).some((system) => system.overAllocation) ? (
                  <p className="m-0 text-warn">{t('systemOverAllocation')}</p>
                ) : null}
                {(summary.aiSystems ?? []).map((system) => (
                  <p key={system.systemId} className="m-0">
                    {t('aiBreakdown', {
                      name: system.name,
                      mode: system.costMode
                        ? tStakeholders(`aiCostMode.${system.costMode}`)
                        : '—',
                      cost: formatMoney(system.billableCost, currency, locale),
                    })}
                    {system.overAllocation ? ` · ${t('aiOverAllocationShort')}` : ''}
                  </p>
                ))}
                {(summary.itSystems ?? []).map((system) => (
                  <p key={system.systemId} className="m-0">
                    {t('systemBreakdown', {
                      name: system.name,
                      mode: system.costMode
                        ? tSystems(`itCostMode.${system.costMode}`)
                        : '—',
                      cost: formatMoney(system.billableCost, currency, locale),
                    })}
                    {system.overAllocation
                      ? ` · ${t('systemOverAllocationShort')}`
                      : ''}
                  </p>
                ))}
              </div>
            </section>
          </div>

          <section className="kh-ops-panel">
            <div className="kh-ops-panel-head">
              <h2 className="kh-ops-panel-title">{t('epicRollups')}</h2>
            </div>
            {summary.epics.length === 0 ? (
              <p className="kh-ops-empty">{t('epicRollupsEmpty')}</p>
            ) : (
              <div className="kh-ops-table-wrap">
                <table className="kh-ops-data-table">
                  <thead>
                    <tr>
                      <th>{t('epic')}</th>
                      <th className="kh-ops-num">{t('forecastHoursShort')}</th>
                      <th className="kh-ops-num">{t('actualHoursShort')}</th>
                      <th className="kh-ops-num">{t('forecastCostShort')}</th>
                      <th className="kh-ops-num">{t('actualCostShort')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.epics.map((epic) => (
                      <tr key={epic.epicId}>
                        <td className="kh-ops-primary-cell">{epic.title}</td>
                        <td className="kh-ops-num">{epic.forecastHours}</td>
                        <td className="kh-ops-num">{epic.actualHours}</td>
                        <td className="kh-ops-num">
                          {formatMoney(epic.forecastCost, currency, locale)}
                        </td>
                        <td className="kh-ops-num">
                          {formatMoney(epic.actualCost, currency, locale)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <p className="m-0 text-xs text-ink-muted">
            {canMutate ? t('hint') : t('readOnlyHint')}
          </p>
        </div>
      ) : null}
    </CollapsibleSection>

    <Modal
      open={burndownOpen}
      onClose={() => setBurndownOpen(false)}
      title={t('burndown')}
      description={t('burndownLandscapeHint')}
      size="full"
      bodyClassName="!block"
      footer={
        <Button type="button" variant="secondary" onClick={() => setBurndownOpen(false)}>
          {tCommon('close')}
        </Button>
      }
    >
      <p className="mt-0 mb-3 text-xs text-ink-muted">{t('burndownLegend')}</p>
      {summary ? (
        <BurndownChart
          bac={summary.bac}
          startDate={summary.startDate}
          endDate={summary.endDate}
          burndown={summary.burndown}
          variant="landscape"
        />
      ) : null}
    </Modal>
    </>
  );
}
