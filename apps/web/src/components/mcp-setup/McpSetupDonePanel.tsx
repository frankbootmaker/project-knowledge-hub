'use client';

import { useTranslations } from 'next-intl';
import { Button, Panel } from '../ui';
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
    <Panel className="grid gap-4">
      <div>
        <h3 className="mt-0 mb-1 text-base font-semibold">{t('mcpWizardDoneTitle')}</h3>
        <p className="m-0 text-sm text-ink-muted">
          {clientName
            ? t('mcpWizardDoneBlurbNamed', { name: clientName })
            : t('mcpWizardDoneBlurb')}
        </p>
        <p className="mt-2 mb-0 text-sm text-ink-muted">
          {variant === 'admin'
            ? t('mcpWizardDoneNextAdmin')
            : t('mcpWizardDoneNextUser')}
        </p>
      </div>
      <McpConnectionTroubleshoot variant={variant} mcpUrl={mcpUrl} />
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={onStartAnother}>
          {t('mcpWizardStartAnother')}
        </Button>
      </div>
    </Panel>
  );
}
