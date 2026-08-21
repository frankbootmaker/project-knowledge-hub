'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { applyBrand, brandIds, brandMeta, type BrandId } from '../lib/brand';
import { setBrandAction } from '../lib/brand-actions';
import { cn } from '../lib/cn';

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
    <section id="brand" className="kh-ops-panel scroll-mt-20">
      <div className="kh-ops-panel-head">
        <h2 className="kh-ops-panel-title">{t('brandTitle')}</h2>
      </div>
      <div className="kh-ops-card-body">
      <p className="mt-0 mb-4 text-sm text-ink-muted">{t('brandBlurb')}</p>
      <div className="kh-ops-project-grid px-0">
        {brandIds.map((id) => {
          const active = brand === id;
          return (
            <button
              key={id}
              type="button"
              disabled={pending}
              data-brand-choice={id}
              className={cn('kh-ops-project-card', active && 'selected')}
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
              <p>{t(`brand_${id}`)}</p>
              <div className="kh-ops-project-card-foot">
                <span>{active ? t('brandActive') : t('brandUse')}</span>
              </div>
            </button>
          );
        })}
      </div>
      </div>
    </section>
  );
}
