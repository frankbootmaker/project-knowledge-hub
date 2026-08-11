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
  aiNoteOnlyTokens: number;
  aiSystems: AiBudgetBreakdown[];
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
    const response = await fetch(
      `/api/v1/projects/${projectId}/budget-summary`,
    );
    if (!response.ok) return;
    const payload = (await response.json()) as {
      budget?: ProjectBudgetSummary;
    };
    if (payload.budget) {
      setSummary(payload.budget);
      setApprovedBudget(
        payload.budget.approvedBudget != null
          ? String(payload.budget.approvedBudget)
          : '',
      );
    }
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

      {!summary ? (
        <p className="m-0 text-sm text-ink-muted">{tCommon('loading')}</p>
      ) : (
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

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {(
              [
                ['bac', summary.bac],
                ['ev', summary.ev],
                ['ac', summary.ac],
              ] as const
            ).map(([key, value]) => (
              <div
                key={key}
                className="rounded-md border border-line bg-panel-solid p-3"
              >
                <p className="m-0 text-xs font-medium uppercase tracking-wide text-ink-muted">
                  {t(`kpi.${key}`)}
                </p>
                <p className="mt-1 mb-0 text-lg font-semibold text-ink">
                  {formatMoney(value, currency, locale)}
                </p>
              </div>
            ))}
            <div className="rounded-md border border-line bg-panel-solid p-3">
              <p className="m-0 text-xs font-medium uppercase tracking-wide text-ink-muted">
                {t('kpi.cpi')}
              </p>
              <p className="mt-1 mb-0 text-lg font-semibold text-ink">
                {formatIndex(summary.cpi)}
              </p>
            </div>
            <div className="rounded-md border border-line bg-panel-solid p-3">
              <p className="m-0 text-xs font-medium uppercase tracking-wide text-ink-muted">
                {t('kpi.spi')}
              </p>
              <p className="mt-1 mb-0 text-lg font-semibold text-ink">
                {formatIndex(summary.spi)}
              </p>
            </div>
          </div>

          <div className="grid gap-1 text-xs text-ink-muted">
            <p className="m-0">
              {t('acBreakdown', {
                person: formatMoney(summary.personAc ?? summary.ac, currency, locale),
                ai: formatMoney(summary.aiAc ?? 0, currency, locale),
              })}
            </p>
            {(summary.aiNoteOnlyTokens ?? 0) > 0 ? (
              <p className="m-0">
                {t('aiNoteOnlyTokens', { count: summary.aiNoteOnlyTokens })}
              </p>
            ) : null}
            {(summary.aiSystems ?? []).some((system) => system.overAllocation) ? (
              <p className="m-0 text-warn">
                {t('aiOverAllocation')}
              </p>
            ) : null}
            {(summary.aiSystems ?? []).length > 0 ? (
              <ul className="m-0 grid list-none gap-1 p-0">
                {(summary.aiSystems ?? []).map((system) => (
                  <li key={system.systemId}>
                    {t('aiBreakdown', {
                      name: system.name,
                      mode: system.costMode
                        ? tStakeholders(`aiCostMode.${system.costMode}`)
                        : '—',
                      cost: formatMoney(system.billableCost, currency, locale),
                    })}
                    {system.overAllocation ? ` · ${t('aiOverAllocationShort')}` : ''}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <div>
            <p className="mt-0 mb-2 text-xs font-medium uppercase tracking-wide text-ink-muted">
              {t('burndown')}
            </p>
            <p className="mt-0 mb-2 text-xs text-ink-muted">{t('burndownLegend')}</p>
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

          <div>
            <p className="mt-0 mb-2 text-xs font-medium uppercase tracking-wide text-ink-muted">
              {t('epicRollups')}
            </p>
            {summary.epics.length === 0 ? (
              <p className="m-0 text-sm text-ink-muted">{t('epicRollupsEmpty')}</p>
            ) : (
              <>
                <ul className="m-0 grid list-none gap-2 p-0 md:hidden">
                  {summary.epics.map((epic) => (
                    <li
                      key={epic.epicId}
                      className="rounded-md border border-line bg-panel-solid p-3"
                    >
                      <p className="m-0 text-sm font-semibold text-ink">
                        {epic.title}
                      </p>
                      <dl className="mt-2 mb-0 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                        <div>
                          <dt className="m-0 font-medium text-ink-muted">
                            {t('forecastHoursShort')}
                          </dt>
                          <dd className="m-0 text-ink">{epic.forecastHours}</dd>
                        </div>
                        <div>
                          <dt className="m-0 font-medium text-ink-muted">
                            {t('actualHoursShort')}
                          </dt>
                          <dd className="m-0 text-ink">{epic.actualHours}</dd>
                        </div>
                        <div>
                          <dt className="m-0 font-medium text-ink-muted">
                            {t('forecastCostShort')}
                          </dt>
                          <dd className="m-0 text-ink">
                            {formatMoney(epic.forecastCost, currency, locale)}
                          </dd>
                        </div>
                        <div>
                          <dt className="m-0 font-medium text-ink-muted">
                            {t('actualCostShort')}
                          </dt>
                          <dd className="m-0 text-ink">
                            {formatMoney(epic.actualCost, currency, locale)}
                          </dd>
                        </div>
                      </dl>
                    </li>
                  ))}
                </ul>
                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead>
                      <tr className="border-b border-line uppercase tracking-wide text-ink-muted">
                        <th className="py-1.5 pr-2 font-medium">{t('epic')}</th>
                        <th className="py-1.5 pr-2 font-medium whitespace-nowrap">
                          {t('forecastHoursShort')}
                        </th>
                        <th className="py-1.5 pr-2 font-medium whitespace-nowrap">
                          {t('actualHoursShort')}
                        </th>
                        <th className="py-1.5 pr-2 font-medium whitespace-nowrap">
                          {t('forecastCostShort')}
                        </th>
                        <th className="py-1.5 font-medium whitespace-nowrap">
                          {t('actualCostShort')}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.epics.map((epic) => (
                        <tr
                          key={epic.epicId}
                          className="border-b border-line/70"
                        >
                          <td className="max-w-[14rem] truncate py-1.5 pr-2 font-medium text-ink">
                            {epic.title}
                          </td>
                          <td className="py-1.5 pr-2 whitespace-nowrap text-ink-muted">
                            {epic.forecastHours}
                          </td>
                          <td className="py-1.5 pr-2 whitespace-nowrap text-ink-muted">
                            {epic.actualHours}
                          </td>
                          <td className="py-1.5 pr-2 whitespace-nowrap text-ink-muted">
                            {formatMoney(epic.forecastCost, currency, locale)}
                          </td>
                          <td className="py-1.5 whitespace-nowrap text-ink-muted">
                            {formatMoney(epic.actualCost, currency, locale)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>

          <p className="m-0 text-xs text-ink-muted">
            {canMutate ? t('hint') : t('readOnlyHint')}
          </p>
        </div>
      )}
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
