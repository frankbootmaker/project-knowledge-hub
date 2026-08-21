'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { PageRefreshButton } from './PageRefreshButton';

export const manageMenuItemClass =
  'kh-ops-choice';

export const manageMenuLinkClass =
  'kh-ops-choice';

/** Refresh + Manage (or other page actions) on the same toolbar row. */
export function ManageToolbar({ children }: { children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <PageRefreshButton />
      {children}
    </div>
  );
}

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
        <span className="kh-ops-choice-copy">
          <strong>{props.title}</strong>
          <span>{props.hint}</span>
        </span>
        <span aria-hidden>
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
        <span className="kh-ops-choice-copy">
          <strong>{props.title}</strong>
          <span>{props.hint}</span>
        </span>
        <span aria-hidden>
          →
        </span>
      </Link>
    </li>
  );
}
