'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { Button } from './ui';

function RefreshIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className={`size-4 shrink-0${spinning ? ' animate-spin' : ''}`}
      fill="none"
    >
      <path
        d="M4.5 12a7.5 7.5 0 0 1 12.7-5.4M19.5 12a7.5 7.5 0 0 1-12.7 5.4"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      <path
        d="M16.5 3.75v3.75H20.25M7.5 20.25v-3.75H3.75"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Secondary control matching Manage — reloads current-route server data. */
export function PageRefreshButton() {
  const t = useTranslations('common');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const label = pending ? t('refreshingPage') : t('refreshPage');

  return (
    <Button
      type="button"
      variant="secondary"
      disabled={pending}
      aria-label={label}
      title={label}
      onClick={() => {
        startTransition(() => {
          router.refresh();
        });
      }}
    >
      <span className="inline-flex items-center gap-2">
        <RefreshIcon spinning={pending} />
        <span>{label}</span>
      </span>
    </Button>
  );
}
