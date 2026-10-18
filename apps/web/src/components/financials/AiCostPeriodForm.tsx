'use client';

import { useTranslations } from 'next-intl';
import { Button, Field, Input, LinkButton } from '../ui';

export type AiCostViewRange = 'last12' | 'year' | 'all' | 'custom';

export function AiCostPeriodForm({
  action,
  from,
  to,
  range,
  preserve = {},
}: {
  action: string;
  from: string;
  to: string;
  range: AiCostViewRange;
  preserve?: Record<string, string>;
}) {
  const t = useTranslations('financials');
  const presets: Array<{ id: 'last12' | 'year' | 'all'; label: string }> = [
    { id: 'last12', label: t('presetLast12') },
    { id: 'year', label: t('presetYear') },
    { id: 'all', label: t('presetAll') },
  ];

  function presetHref(id: 'last12' | 'year' | 'all'): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(preserve)) {
      if (value) params.set(key, value);
    }
    params.set('range', id);
    const query = params.toString();
    return query ? `${action}?${query}` : action;
  }

  return (
    <form method="get" action={action} className="kh-ops-toolbar flex-wrap">
      <div className="flex flex-wrap items-end gap-2" role="group" aria-label={t('period')}>
        {presets.map((preset) => (
          <LinkButton
            key={preset.id}
            href={presetHref(preset.id)}
            variant={range === preset.id ? 'primary' : 'secondary'}
            aria-current={range === preset.id ? 'true' : undefined}
          >
            {preset.label}
          </LinkButton>
        ))}
      </div>
      <Field label={t('from')} className="min-w-36">
        <Input type="month" name="from" defaultValue={from} />
      </Field>
      <Field label={t('to')} className="min-w-36">
        <Input type="month" name="to" defaultValue={to} />
      </Field>
      {Object.entries(preserve).map(([key, value]) =>
        value ? <input key={key} type="hidden" name={key} value={value} /> : null,
      )}
      <Button type="submit" variant="secondary" className="self-end">
        {t('apply')}
      </Button>
    </form>
  );
}
