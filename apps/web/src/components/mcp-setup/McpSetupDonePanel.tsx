'use client';

import { useTranslations } from 'next-intl';
import { Button } from '../ui';
import { McpConnectionTroubleshoot } from './McpConnectionTroubleshoot';

export function McpSetupDonePanel({
  variant,
  clientName,
  mcpUrl,
  onStartAnother,
}: {
  variant: 'user' | 'admin';
  clientName?: string | null;
  mcpUrl?: string;
  onStartAnother: () => void;
}) {
  const t = useTranslations('admin');

  return (
    <section className="kh-ops-panel">
      <div className="kh-ops-panel-head">
        <h3 className="kh-ops-panel-title">{t('mcpWizardDoneTitle')}</h3>
      </div>
      <div className="kh-ops-card-body grid gap-4">
        <p className="m-0 text-sm text-ink-muted">
          {clientName
            ? t('mcpWizardDoneBlurbNamed', { name: clientName })
            : t('mcpWizardDoneBlurb')}
        </p>
        <p className="m-0 text-sm text-ink-muted">
          {variant === 'admin'
            ? t('mcpWizardDoneNextAdmin')
            : t('mcpWizardDoneNextUser')}
        </p>
        <McpConnectionTroubleshoot variant={variant} mcpUrl={mcpUrl} />
      </div>
      <div className="kh-ops-action-line">
        <span className="kh-ops-panel-meta">{t('mcpWizardDoneTitle')}</span>
        <Button type="button" onClick={onStartAnother}>
          {t('mcpWizardStartAnother')}
        </Button>
      </div>
    </section>
  );
}
