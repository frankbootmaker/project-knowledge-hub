'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { isIsoDay } from '@project-knowledge-hub/domain';
import { Button, Field, Input, LinkButton } from '../ui';

export type AiCostViewRange = 'last12' | 'year' | 'quarter' | 'month' | 'all' | 'custom';

export type AiCostGrain = 'month' | 'week' | 'day';

const PRESETS = ['last12', 'year', 'quarter', 'month', 'all'] as const;

function withParams(action: string, params: URLSearchParams): string {
  const query = params.toString();
  return query ? `${action}?${query}` : action;
}

export function AiCostPeriodForm({
  action,
  from,
  to,
  fromDay,
  toDay,
  range,
  preserve = {},
}: {
  action: string;
  from: string;
  to: string;
  fromDay?: string;
  toDay?: string;
  range: AiCostViewRange;
  preserve?: Record<string, string>;
}) {
  const t = useTranslations('financials');
  const [timeZone, setTimeZone] = useState(preserve.tz || 'UTC');
  const [activeRange, setActiveRange] = useState<AiCostViewRange>(range);
  const initialFrom = isIsoDay(fromDay ?? '') ? (fromDay as string) : isIsoDay(from) ? from : '';
  const initialTo = isIsoDay(toDay ?? '') ? (toDay as string) : isIsoDay(to) ? to : '';
  const [fromValue, setFromValue] = useState(initialFrom);
  const [toValue, setToValue] = useState(initialTo);

  useEffect(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (zone) setTimeZone(zone);
  }, []);

  const labels: Record<(typeof PRESETS)[number], string> = {
    last12: t('presetLast12'),
    year: t('presetYear'),
    quarter: t('presetQuarter'),
    month: t('presetMonth'),
    all: t('presetAll'),
  };

  function presetHref(id: (typeof PRESETS)[number]): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(preserve)) {
      if (value && key !== 'range' && key !== 'from' && key !== 'to') params.set(key, value);
    }
    params.set('range', id);
    params.set('tz', timeZone);
    return withParams(action, params);
  }

  return (
    <form method="get" action={action} className="kh-ops-toolbar flex-wrap">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('period')}>
        {PRESETS.map((preset) => (
          <LinkButton
            key={preset}
            href={presetHref(preset)}
            variant={activeRange === preset ? 'primary' : 'secondary'}
            aria-current={activeRange === preset ? 'true' : undefined}
          >
            {labels[preset]}
          </LinkButton>
        ))}
      </div>
      <Field label={t('from')} className="kh-ops-period-field">
        <Input
          type="date"
          value={fromValue}
          onChange={(event) => {
            const next = event.target.value;
            setFromValue(next);
            setToValue((current) => (current && next && current < next ? next : current));
            setActiveRange('custom');
          }}
        />
      </Field>
      <Field label={t('to')} className="kh-ops-period-field">
        <Input
          type="date"
          value={toValue}
          onChange={(event) => {
            const next = event.target.value;
            setToValue(next);
            setFromValue((current) => (current && next && next < current ? next : current));
            setActiveRange('custom');
          }}
        />
      </Field>
      {activeRange !== 'custom' ? <input type="hidden" name="range" value={activeRange} /> : null}
      {activeRange === 'custom' && fromValue ? (
        <input type="hidden" name="from" value={fromValue} />
      ) : null}
      {activeRange === 'custom' && toValue ? (
        <input type="hidden" name="to" value={toValue} />
      ) : null}
      <input type="hidden" name="tz" value={timeZone} />
      {Object.entries(preserve).map(([key, value]) =>
        value && key !== 'tz' ? <input key={key} type="hidden" name={key} value={value} /> : null,
      )}
      <Button type="submit" variant="secondary">
        {t('apply')}
      </Button>
    </form>
  );
}

export function AiCostGrainToggle({
  action,
  grain,
  adjusted,
  preserve = {},
}: {
  action: string;
  grain: AiCostGrain;
  adjusted?: boolean;
  preserve?: Record<string, string>;
}) {
  const t = useTranslations('financials');
  const choices: Array<{ id: AiCostGrain; label: string }> = [
    { id: 'month', label: t('grainMonth') },
    { id: 'week', label: t('grainWeek') },
    { id: 'day', label: t('grainDay') },
  ];

  function href(id: AiCostGrain): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(preserve)) {
      if (value && key !== 'grain') params.set(key, value);
    }
    params.set('grain', id);
    return withParams(action, params);
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-end gap-2" role="group" aria-label={t('grainLabel')}>
        {choices.map((choice) => (
          <LinkButton
            key={choice.id}
            href={href(choice.id)}
            variant={grain === choice.id ? 'primary' : 'secondary'}
            aria-current={grain === choice.id ? 'true' : undefined}
          >
            {choice.label}
          </LinkButton>
        ))}
      </div>
      {adjusted ? <p className="m-0 text-[13px] text-ink-muted">{t('grainAdjusted')}</p> : null}
    </div>
  );
}
