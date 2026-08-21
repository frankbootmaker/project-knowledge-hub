'use client';

import { useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';

/**
 * Collapses summary / links / source metadata behind a single disclosure
 * so the markdown body stays primary on the record detail page.
 */
export function KnowledgeRecordMoreDetails({
  leading,
  trailing,
  summary,
  links,
  sourceRows,
}: {
  /** Status badges / lifecycle actions on the same row, after the disclosure. */
  leading?: ReactNode;
  /** Right-aligned actions (e.g. Manage menu) on the toolbar row. */
  trailing?: ReactNode;
  summary: ReactNode;
  links?: ReactNode;
  sourceRows: Array<{ label: string; value: ReactNode }>;
}) {
  const t = useTranslations('records');
  const [open, setOpen] = useState(false);
  const hasStrip = Boolean(leading || trailing);

  return (
    <section className="kh-ops-panel">
      {hasStrip ? (
        <div className="kh-ops-manage-strip">
          <button
            type="button"
            className="kh-btn kh-btn-secondary inline-flex items-center gap-2 text-sm"
            aria-expanded={open}
            onClick={() => setOpen((current) => !current)}
          >
            {open ? t('hideMoreDetails') : t('showMoreDetails')}
          </button>
          {leading ? (
            <div className="flex min-w-0 flex-wrap items-center gap-2">{leading}</div>
          ) : null}
          {trailing ? (
            <div className="ml-auto flex shrink-0 flex-wrap items-center gap-2">
              {trailing}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="kh-ops-panel-head">
          <h2 className="kh-ops-panel-title">{t('showMoreDetails')}</h2>
          <button
            type="button"
            className="kh-ops-text-btn"
            aria-expanded={open}
            onClick={() => setOpen((current) => !current)}
          >
            {open ? t('hideMoreDetails') : t('showMoreDetails')}
          </button>
        </div>
      )}
      {open ? (
        <div className="kh-ops-card-body grid gap-6">
          <div className="grid gap-2">
            <h2 className="kh-ops-panel-title m-0">{t('summaryAndLinks')}</h2>
            <div className="grid gap-2 text-sm">{summary}</div>
            {links ? <div className="grid gap-2 text-sm">{links}</div> : null}
          </div>
          <div>
            <h2 className="kh-ops-panel-title mt-0 mb-2">
              {t('sourceAndVerification')}
            </h2>
            <dl className="kh-ops-keyvals">
              {sourceRows.map((row) => (
                <div key={row.label} className="contents">
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      ) : null}
    </section>
  );
}
