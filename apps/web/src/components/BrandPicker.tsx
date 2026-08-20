'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { applyBrand, brandIds, brandMeta, type BrandId } from '../lib/brand';
import { setBrandAction } from '../lib/brand-actions';
import { cn } from '../lib/cn';
import { Panel } from './ui';

const brandSwatches: Record<BrandId, [string, string]> = {
  knowhub: ['oklch(52% 0.14 145)', 'oklch(58% 0.16 145)'],
  bootmaker: ['#1e3a8a', '#6366f1'],
  nethorizon: ['#0f766e', '#14b8a6'],
  in3: ['#4338ca', '#6366f1'],
};

export function BrandPicker({ initialBrand }: { initialBrand: BrandId }) {
  const t = useTranslations('account');
  const router = useRouter();
  const [brand, setBrand] = useState<BrandId>(initialBrand);
  const [pending, startTransition] = useTransition();

  return (
    <Panel id="brand" className="scroll-mt-20">
      <h2 className="mt-0 mb-1 font-display text-base font-semibold">
        {t('brandTitle')}
      </h2>
      <p className="mt-0 mb-4 text-sm text-ink-muted">{t('brandBlurb')}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {brandIds.map((id) => {
          const active = brand === id;
          return (
            <button
              key={id}
              type="button"
              disabled={pending}
              data-brand-choice={id}
              className={cn(
                'rounded-sm border border-line bg-panel-solid p-0 text-left',
                active && 'border-brand shadow-[inset_0_3px_0_var(--kh-accent)]',
              )}
              onClick={() => {
                setBrand(id);
                applyBrand(id);
                startTransition(async () => {
                  await setBrandAction(id);
                  router.refresh();
                });
              }}
            >
              <span
                className="flex h-12 overflow-hidden border-b border-line"
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
              <span className="block p-3">
                <span className="block font-display text-base font-semibold">
                  {brandMeta[id].label}
                </span>
                <span className="mt-1 block text-xs text-ink-muted">
                  {t(`brand_${id}`)}
                </span>
                <span
                  className={cn(
                    'mt-2 block font-mono text-[11px] uppercase',
                    active ? 'font-semibold text-brand' : 'text-ink-muted',
                  )}
                >
                  {active ? t('brandActive') : t('brandUse')}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </Panel>
  );
}
