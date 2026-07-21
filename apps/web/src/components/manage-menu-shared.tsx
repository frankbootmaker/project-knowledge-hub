'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';

export const manageMenuItemClass =
  'kh-panel-inset flex w-full cursor-pointer items-center justify-between gap-3 border border-line bg-panel-solid text-left transition hover:border-brand/35';

export const manageMenuLinkClass =
  'kh-panel-inset flex items-center justify-between gap-3 no-underline transition hover:border-brand/35';

export function ManageDetailRow(props: {
  label: string;
  value: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-[8.5rem_1fr] sm:gap-3">
      <dt className="text-sm text-ink-muted">{props.label}</dt>
      <dd
        className={
          props.mono
            ? 'm-0 break-all font-mono text-sm text-ink'
            : 'm-0 text-sm text-ink'
        }
      >
        {props.value}
      </dd>
    </div>
  );
}

export function ManageMenuItem(props: {
  title: string;
  hint: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <li>
      <button
        type="button"
        className={manageMenuItemClass}
        disabled={props.disabled}
        onClick={props.onClick}
      >
        <span>
          <span className="block font-medium text-ink">{props.title}</span>
          <span className="mt-0.5 block text-sm text-ink-muted">{props.hint}</span>
        </span>
        <span className="text-ink-muted" aria-hidden>
          →
        </span>
      </button>
    </li>
  );
}

export function ManageMenuLink(props: {
  href: string;
  title: string;
  hint: string;
  onClick?: () => void;
}) {
  return (
    <li>
      <Link href={props.href} className={manageMenuLinkClass} onClick={props.onClick}>
        <span>
          <span className="block font-medium text-ink">{props.title}</span>
          <span className="mt-0.5 block text-sm text-ink-muted">{props.hint}</span>
        </span>
        <span className="text-ink-muted" aria-hidden>
          →
        </span>
      </Link>
    </li>
  );
}
