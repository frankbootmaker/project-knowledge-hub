'use client';

import { useTranslations } from 'next-intl';
import { MCP_SETUP_STEPS, type McpSetupStep } from './scopes';

export function McpWizardStepStrip({
  step,
  token,
  preflightOk,
  onSelect,
}: {
  step: McpSetupStep;
  token: string | null;
  preflightOk: boolean;
  onSelect: (step: McpSetupStep) => void;
}) {
  const t = useTranslations('admin');
  const stepIndex = MCP_SETUP_STEPS.indexOf(step);

  return (
    <div className="kh-ops-stage-strip" aria-label={t('mcpSetup')}>
      {MCP_SETUP_STEPS.map((item, index) => {
        const active = item === step;
        const done = index < stepIndex;
        const disabled =
          (item === 'create' && !token) ||
          (item === 'test' && !token) ||
          (item === 'schema' && !token) ||
          (item === 'done' && !token) ||
          (item === 'configure' && !preflightOk);
        return (
          <button
            key={item}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(item)}
            className={[
              'kh-ops-stage-card',
              active ? 'active' : done ? 'done' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <small>{String(index + 1).padStart(2, '0')}</small>
            <strong>{t(`mcpWizardStep_${item}`)}</strong>
          </button>
        );
      })}
    </div>
  );
}
