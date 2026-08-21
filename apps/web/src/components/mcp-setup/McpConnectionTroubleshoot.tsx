'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

const USER_TIPS = [
  'mcpWizardTrouble_pasteToken',
  'mcpWizardTrouble_reloadClient',
  'mcpWizardTrouble_httpsReachable',
  'mcpWizardTrouble_workspaceScope',
  'mcpWizardTrouble_rotateToken',
] as const;

const ADMIN_TIPS = [
  'mcpWizardTroubleAdmin_urlSource',
  'mcpWizardTroubleAdmin_middleware',
  'mcpWizardTroubleAdmin_wellKnown',
  'mcpWizardTroubleAdmin_curl',
  'mcpWizardTroubleAdmin_docker',
  'mcpWizardTroubleAdmin_rateLimit',
] as const;

export function McpConnectionTroubleshoot({
  variant,
  mcpUrl,
  defaultOpen = false,
}: {
  variant: 'user' | 'admin';
  mcpUrl?: string;
  defaultOpen?: boolean;
}) {
  const t = useTranslations('admin');
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="kh-ops-panel mb-0">
      <button
        type="button"
        className="kh-ops-panel-head w-full cursor-pointer text-left"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="kh-ops-panel-title">{t('mcpWizardTroubleshootTitle')}</span>
        <span className="kh-ops-panel-meta">
          {open ? t('mcpWizardTroubleshootHide') : t('mcpWizardTroubleshootShow')}
        </span>
      </button>
      {open ? (
        <div className="kh-ops-card-body grid gap-3">
          <p className="m-0 text-sm text-ink-muted">{t('mcpWizardTroubleshootIntro')}</p>
          <ul className="m-0 grid list-disc gap-2 pl-5 text-sm text-ink-muted">
            {USER_TIPS.map((key) => (
              <li key={key}>{t(key)}</li>
            ))}
          </ul>
          {variant === 'admin' ? (
            <div className="grid gap-2">
              <p className="m-0 text-sm font-medium">{t('mcpWizardTroubleshootAdminTitle')}</p>
              <ul className="m-0 grid list-disc gap-2 pl-5 text-sm text-ink-muted">
                {ADMIN_TIPS.map((key) => (
                  <li key={key}>
                    {key === 'mcpWizardTroubleAdmin_curl' && mcpUrl
                      ? t(key, { mcpUrl })
                      : t(key)}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
