import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';
import type { NavIconName } from '../../lib/ops-nav';

const paths: Record<NavIconName, ReactNode> = {
  personal: (
    <>
      <circle cx="12" cy="8" r="3" />
      <path d="M5 20v-2a7 7 0 0114 0v2" />
    </>
  ),
  deliveryFinance: <path d="M4 19V9M10 19V5M16 19v-7M22 19H2" />,
  control: <path d="M12 3l8 4.5-8 4.5-8-4.5zM4 12l8 4.5 8-4.5" />,
  knowledge: <path d="M5 4h11l3 3v13H5zM16 4v4h4" />,
  ops: (
    <>
      <rect x="4" y="6" width="16" height="13" rx="2" />
      <path d="M9 11h.01M15 11h.01" />
    </>
  ),
  admin: <path d="M12 3l8 4v5c0 5-3.4 8-8 9-4.6-1-8-4-8-9V7z" />,
  myWork: <path d="M4 5h16v14H4zM8 9h8M8 13h5" />,
  workspace: <path d="M3 6h7l2 2h9v11H3z" />,
  search: (
    <>
      <circle cx="10" cy="10" r="6" />
      <path d="M15 15l5 5" />
    </>
  ),
  overview: <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" />,
  delivery: <path d="M4 19V9M10 19V5M16 19v-7M22 19H2" />,
  scrum: <path d="M5 5h14v14H5zM5 10h14M10 5v14" />,
  timeline: <path d="M4 6h9M4 12h16M4 18h12" />,
  calendar: <path d="M4 5h16v15H4zM8 3v4M16 3v4M4 9h16" />,
  budget: <path d="M4 7h16v12H4zM7 7V5h10v2M8 12h8M8 15h5" />,
  systems: <path d="M12 3l8 4.5-8 4.5-8-4.5zM4 12l8 4.5 8-4.5M4 16.5l8 4.5 8-4.5" />,
  raid: <path d="M12 3l9 17H3zM12 9v4M12 17h.01" />,
  stakeholders: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20v-2a5 5 0 015-5h2a5 5 0 015 5v2M16 7h5" />
    </>
  ),
  utilization: <path d="M4 18V9M9 18V5M14 18v-7M19 18V7" />,
  org: <path d="M12 4v5M5 20v-5h14v5M5 15v-4h14v4" />,
  baseline: <path d="M5 3v18M5 7h13l-2 4 2 4H5" />,
  knowledgeItem: <path d="M5 4h11l3 3v13H5zM16 4v4h4M8 12h8" />,
  media: <path d="M4 5h16v14H4zM7 15l4-4 3 3 2-2 4 4" />,
  archive: <path d="M4 7h16v13H4zM3 4h18v3H3zM9 11h6" />,
  import: <path d="M12 3v12M7 10l5 5 5-5M4 19h16" />,
  agents: (
    <>
      <rect x="4" y="6" width="16" height="13" rx="2" />
      <path d="M9 11h.01M15 11h.01M9 15h6M12 6V3" />
    </>
  ),
  reports: <path d="M5 19V9M10 19V5M15 19v-7M20 19V7" />,
  monitoring: <path d="M3 12h4l2-6 4 12 2-6h6" />,
  apiClients: (
    <>
      <circle cx="8" cy="10" r="3.5" />
      <path d="M11 10h10M18 10v3M21 10v4" />
    </>
  ),
  storage: (
    <>
      <ellipse cx="12" cy="6" rx="8" ry="3" />
      <path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6" />
    </>
  ),
  aiProviders: (
    <path d="M12 3l1.6 6.4L20 11l-6.4 1.6L12 19l-1.6-6.4L4 11l6.4-1.6z" />
  ),
  backups: (
    <path d="M5 12a7 7 0 0112.5-4.2M19 4v5h-5M19 12a7 7 0 01-12.5 4.2M5 20v-5h5" />
  ),
  mcpSetup: <path d="M9 3v5M15 3v5M7 8h10v6a5 5 0 01-10 0zM12 14v4" />,
  brand: (
    <>
      <rect x="3" y="4" width="5" height="5" />
      <rect x="10" y="4" width="5" height="5" />
      <rect x="17" y="4" width="4" height="5" />
      <path d="M6 14l4-4 7 7-3 3H9z" />
    </>
  ),
  users: (
    <>
      <circle cx="8" cy="8" r="3" />
      <circle cx="17" cy="9" r="2.2" />
      <path d="M3 20v-1.5A5 5 0 018 13.5h1A5 5 0 0114 18.5V20M14.5 20v-1a4 4 0 013.5-4h1A4 4 0 0122 19v1" />
    </>
  ),
  organizations: (
    <>
      <path d="M4 21V8l8-4 8 4v13M10 21v-6h4v6" />
      <rect x="8" y="10" width="2" height="2" />
      <rect x="11" y="10" width="2" height="2" />
      <rect x="14" y="10" width="2" height="2" />
      <rect x="8" y="14" width="2" height="2" />
      <rect x="14" y="14" width="2" height="2" />
    </>
  ),
  memberships: (
    <path d="M12 3l2.6 5.3 5.9.7-4.4 4 1.2 5.8L12 16.2 6.7 18.8l1.2-5.8-4.4-4 5.9-.7z" />
  ),
  audit: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v5l3.5 2" />
    </>
  ),
  email: <path d="M4 7h16v11H4zM4 7l8 6 8-6" />,
  sso: (
    <>
      <circle cx="8" cy="12" r="3" />
      <path d="M11 12h9M17 12v3M20 12v4" />
    </>
  ),
  templates: <path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" />,
  adminArchive: (
    <>
      <rect x="4" y="6" width="16" height="14" rx="1" />
      <circle cx="12" cy="14" r="3" />
      <path d="M12 14h3M4 6V4h16v2" />
    </>
  ),
};

export function NavIcon({
  name,
  className,
}: {
  name: NavIconName;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className={cn('kh-ops-icon', className)}
      fill="none"
    >
      {paths[name]}
    </svg>
  );
}

export function RailModeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="kh-ops-icon" fill="none">
      <path d="M4 5h16v14H4zM9 5v14" />
    </svg>
  );
}

export function MenuGlyphIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="kh-ops-icon" fill="none">
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

export function SearchGlyphIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="kh-ops-icon" fill="none">
      <circle cx="11" cy="11" r="6" />
      <path d="M16 16l4 4" />
    </svg>
  );
}
