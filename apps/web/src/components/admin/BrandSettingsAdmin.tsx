'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { applyBrand, brandIds, brandMeta, type BrandId } from '../../lib/brand';
import { cn } from '../../lib/cn';
import { ErrorText, Switch, useToast } from '../ui';

const brandSwatches: Record<BrandId, [string, string]> = {
  knowhub: ['oklch(52% 0.14 145)', 'oklch(58% 0.16 145)'],
  bootmaker: ['#1e3a8a', '#6366f1'],
  nethorizon: ['#0f766e', '#14b8a6'],
  in3: ['#4338ca', '#6366f1'],
};

export type PlatformBrandSettings = {
  defaultBrand: BrandId;
  locked: boolean;
};

export function BrandSettingsAdmin({
  initialSettings,
}: {
  initialSettings: PlatformBrandSettings;
}) {
  const t = useTranslations('admin');
  const tAccount = useTranslations('account');
  const router = useRouter();
  const { pushToast } = useToast();
  const [defaultBrand, setDefaultBrand] = useState<BrandId>(
    initialSettings.defaultBrand,
  );
  const [locked, setLocked] = useState(initialSettings.locked);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function persist(
    next: PlatformBrandSettings,
    key: string,
    previous: PlatformBrandSettings,
  ) {
    setPendingKey(key);
    setError(null);
    try {
      const response = await fetch('/api/v1/admin/brand-settings', {
        method: 'PUT',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Origin: window.location.origin,
        },
        body: JSON.stringify(next),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
        settings?: PlatformBrandSettings;
      };
      if (!response.ok) {
        throw new Error(body.error?.message ?? `HTTP ${response.status}`);
      }
      const saved = body.settings ?? next;
      setDefaultBrand(saved.defaultBrand);
      setLocked(saved.locked);
      applyBrand(saved.defaultBrand);
      pushToast(t('brandSettingsSaved'));
      router.refresh();
    } catch (err) {
      setDefaultBrand(previous.defaultBrand);
      setLocked(previous.locked);
      applyBrand(previous.defaultBrand);
      const message =
        err instanceof Error ? err.message : t('brandSettingsFailed');
      setError(message);
      pushToast(message, 'danger');
    } finally {
      setPendingKey(null);
    }
  }

  function selectBrand(id: BrandId) {
    if (pendingKey !== null || id === defaultBrand) return;
    const previous = { defaultBrand, locked };
    const next = { defaultBrand: id, locked };
    setDefaultBrand(id);
    applyBrand(id);
    void persist(next, `brand.${id}`, previous);
  }

  function toggleLocked(nextLocked: boolean) {
    if (pendingKey !== null || nextLocked === locked) return;
    const previous = { defaultBrand, locked };
    const next = { defaultBrand, locked: nextLocked };
    setLocked(nextLocked);
    void persist(next, 'locked', previous);
  }

  return (
    <div className="grid gap-3">
      <section className="kh-ops-panel">
        <div className="kh-ops-panel-head">
          <h2 className="kh-ops-panel-title">{t('brandAdminTitle')}</h2>
        </div>
        <div className="kh-ops-card-body">
          <p className="mt-0 mb-4 text-sm text-ink-muted">{t('brandAdminBlurb')}</p>
          <div className="kh-ops-project-grid px-0">
            {brandIds.map((id) => {
              const active = defaultBrand === id;
              return (
                <button
                  key={id}
                  type="button"
                  disabled={pendingKey !== null}
                  data-brand-choice={id}
                  className={cn('kh-ops-project-card', active && 'selected')}
                  onClick={() => selectBrand(id)}
                >
                  <span
                    className="flex h-12 overflow-hidden border border-line"
                    aria-hidden
                  >
                    <i
                      className="flex-1"
                      style={{ background: brandSwatches[id][0] }}
                    />
                    <i
                      className="flex-1"
                      style={{ background: brandSwatches[id][1] }}
                    />
                  </span>
                  <h3>{brandMeta[id].label}</h3>
                  <p>{tAccount(`brand_${id}`)}</p>
                  <div className="kh-ops-project-card-foot">
                    <span>
                      {active ? tAccount('brandActive') : t('brandSetDefault')}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <section className="kh-ops-panel">
        <div className="kh-ops-panel-head">
          <h2 className="kh-ops-panel-title">{t('brandPolicyTitle')}</h2>
        </div>
        <div className="kh-ops-card-body grid gap-0 p-0">
          <div className="kh-ops-setting-row">
            <div>
              <Switch
                id="brand-lock"
                checked={locked}
                disabled={pendingKey !== null}
                label={t('brandLockLabel')}
                onCheckedChange={toggleLocked}
              />
              <p className="m-0 text-[11px] text-ink-muted">{t('brandLockHint')}</p>
            </div>
          </div>
          {error ? (
            <div className="kh-ops-setting-row">
              <ErrorText>{error}</ErrorText>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
