'use client';

import { useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Panel } from './ui';

/**
 * Collapses summary / links / source metadata behind a single disclosure
 * so the markdown body stays primary on the record detail page.
 */
export function KnowledgeRecordMoreDetails({
  leading,
  summary,
  links,
  sourceRows,
}: {
  /** Status badges / actions on the same row, to the right of the disclosure. */
  leading?: ReactNode;
  summary: ReactNode;
  links?: ReactNode;
  sourceRows: Array<{ label: string; value: ReactNode }>;
}) {
  const t = useTranslations('records');
  const [open, setOpen] = useState(false);

  return (
    <Panel className="mb-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
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
      </div>
      {open ? (
        <div className="mt-4 grid gap-6">
          <div className="grid gap-2">
            <h2 className="m-0 text-base font-semibold">{t('summaryAndLinks')}</h2>
            <div className="grid gap-2 text-sm">{summary}</div>
            {links ? <div className="grid gap-2 text-sm">{links}</div> : null}
          </div>
          <div>
            <h2 className="mt-0 mb-3 text-base font-semibold">
              {t('sourceAndVerification')}
            </h2>
            <dl className="m-0 grid grid-cols-[minmax(7rem,10rem)_1fr] gap-x-3 gap-y-1.5 text-sm">
              {sourceRows.map((row) => (
                <div key={row.label} className="contents">
                  <dt className="text-ink-muted">{row.label}</dt>
                  <dd className="m-0 min-w-0 break-words">{row.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      ) : null}
    </Panel>
  );
}
