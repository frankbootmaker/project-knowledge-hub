import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

const iconClassName = 'size-4 shrink-0';

function ListIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={iconClassName} fill="none">
      <path
        d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

function TreeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={iconClassName} fill="none">
      <path
        d="M12 4v6M12 10H7v6M12 10h5v6M7 16v4M17 16v4"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="4" r="1.5" fill="currentColor" />
      <circle cx="7" cy="16" r="1.5" fill="currentColor" />
      <circle cx="17" cy="16" r="1.5" fill="currentColor" />
    </svg>
  );
}

function BoardIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={iconClassName} fill="none">
      <path
        d="M5 5.5h3.5v13H5zM10.25 5.5h3.5v9h-3.5zM15.5 5.5H19v11h-3.5z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={iconClassName} fill="none">
      <path
        d="M6.5 5.5h11A1.5 1.5 0 0 1 19 7v11a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 18V7a1.5 1.5 0 0 1 1.5-1.5ZM5 10h14M9 4.5v2.5M15 4.5v2.5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TimelineIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={iconClassName} fill="none">
      <path
        d="M4 12h16M7 12V8.5M12 12V7M17 12v3.5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      <circle cx="7" cy="8.5" r="1.5" fill="currentColor" />
      <circle cx="12" cy="7" r="1.5" fill="currentColor" />
      <circle cx="17" cy="15.5" r="1.5" fill="currentColor" />
    </svg>
  );
}

function ScrumIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={iconClassName} fill="none">
      <path
        d="M7 7.5h10v3H7zM7 13.5h6.5v3H7z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
      <path
        d="M17.5 14.5a2.5 2.5 0 1 0-2.2 3.7"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      <path
        d="M16.2 16.8 15.3 18.5 17.4 18"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function OrgIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={iconClassName} fill="none">
      <path
        d="M12 5.5v4.5M12 10H8v4M12 10h4v4"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="4.5" r="2" stroke="currentColor" strokeWidth="1.75" />
      <circle cx="8" cy="16.5" r="2" stroke="currentColor" strokeWidth="1.75" />
      <circle cx="16" cy="16.5" r="2" stroke="currentColor" strokeWidth="1.75" />
    </svg>
  );
}

const VIEW_ICONS: Record<string, () => ReactNode> = {
  list: ListIcon,
  tree: TreeIcon,
  board: BoardIcon,
  calendar: CalendarIcon,
  timeline: TimelineIcon,
  scrum: ScrumIcon,
  org: OrgIcon,
};

/** Icon for a delivery/stakeholders view mode (mobile switcher). */
export function ViewModeIcon({
  mode,
  className,
}: {
  mode: string;
  className?: string;
}) {
  const Icon = VIEW_ICONS[mode];
  if (!Icon) return null;
  return (
    <span className={cn('inline-flex items-center justify-center', className)}>
      <Icon />
    </span>
  );
}
