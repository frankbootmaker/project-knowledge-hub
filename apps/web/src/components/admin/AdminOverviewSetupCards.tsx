'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { LinkButton, Switch } from '../ui';

const STORAGE_MCP = 'kh.admin.overview.showMcp';
const STORAGE_EMAIL = 'kh.admin.overview.showEmail';

function readFlag(key: string, fallback = true): boolean {
  if (typeof window === 'undefined') return fallback;
  const raw = window.localStorage.getItem(key);
  if (raw === null) return fallback;
  return raw === '1' || raw === 'true';
}

function writeFlag(key: string, value: boolean): void {
  window.localStorage.setItem(key, value ? '1' : '0');
}

function HideToggle({
  id,
  label,
  onHide,
}: {
  id: string;
  label: string;
  onHide: () => void;
}) {
  return (
    <div className="w-max shrink-0 [&_>div]:justify-start [&_>div]:gap-2">
      <Switch
        id={id}
        label={label}
        checked={false}
        onCheckedChange={(checked) => {
          if (checked) onHide();
        }}
      />
    </div>
  );
}

export function AdminOverviewSetupCards() {
  const t = useTranslations('admin');
  const [ready, setReady] = useState(false);
  const [showMcp, setShowMcp] = useState(true);
  const [showEmail, setShowEmail] = useState(true);

  useEffect(() => {
    setShowMcp(readFlag(STORAGE_MCP, true));
    setShowEmail(readFlag(STORAGE_EMAIL, true));
    setReady(true);
  }, []);

  function setMcpVisible(visible: boolean) {
    setShowMcp(visible);
    writeFlag(STORAGE_MCP, visible);
  }

  function setEmailVisible(visible: boolean) {
    setShowEmail(visible);
    writeFlag(STORAGE_EMAIL, visible);
  }

  if (!ready) {
    return <div className="mb-4 min-h-[1px]" aria-hidden />;
  }

  const anyHidden = !showMcp || !showEmail;
  const hideLabel = t('overviewHide');

  return (
    <div className="mb-4 grid gap-3">
      {showMcp || showEmail ? (
        <div className="kh-ops-admin-link-grid">
          {showMcp ? (
            <article className="kh-ops-admin-link-card">
              <div className="min-w-0">
                <strong>{t('mcpSetup')}</strong>
                <small>{t('mcpWizardBlurb')}</small>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-3">
                <LinkButton href="/admin/mcp-setup">{t('mcpWizardStart')}</LinkButton>
                <HideToggle
                  id="admin-overview-hide-mcp"
                  label={hideLabel}
                  onHide={() => setMcpVisible(false)}
                />
              </div>
            </article>
          ) : null}
          {showEmail ? (
            <article className="kh-ops-admin-link-card">
              <div className="min-w-0">
                <strong>{t('email')}</strong>
                <small>{t('mailOverviewBlurb')}</small>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-3">
                <LinkButton href="/admin/email">{t('mailConfigure')}</LinkButton>
                <HideToggle
                  id="admin-overview-hide-email"
                  label={hideLabel}
                  onHide={() => setEmailVisible(false)}
                />
              </div>
            </article>
          ) : null}
        </div>
      ) : null}

      {anyHidden ? (
        <section className="kh-ops-panel">
          <div className="kh-ops-card-body grid gap-2">
            <p className="m-0 text-sm text-ink-muted">{t('overviewHiddenHint')}</p>
            <div className="flex flex-wrap gap-4">
              {!showMcp ? (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={false}
                    onChange={(e) => {
                      if (e.target.checked) setMcpVisible(true);
                    }}
                  />
                  {t('overviewShowMcp')}
                </label>
              ) : null}
              {!showEmail ? (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={false}
                    onChange={(e) => {
                      if (e.target.checked) setEmailVisible(true);
                    }}
                  />
                  {t('overviewShowEmail')}
                </label>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
