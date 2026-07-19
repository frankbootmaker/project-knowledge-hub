'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../../lib/cn';

type Props = Omit<ComponentProps<typeof Link>, 'className'> & {
  className?: string;
  activeClassName?: string;
  /** `nav` = header; `sidebar` = admin rail */
  tone?: 'nav' | 'sidebar';
  children: ReactNode;
  /** Match exact path only (default: prefix match except for `/`) */
  exact?: boolean;
};

export function NavLink({
  href,
  className,
  activeClassName,
  tone = 'nav',
  exact = false,
  children,
  ...props
}: Props) {
  const pathname = usePathname();
  const hrefPath = typeof href === 'string' ? href : href.pathname || '';
  const active = exact
    ? pathname === hrefPath
    : hrefPath === '/'
      ? pathname === '/'
      : pathname === hrefPath || pathname.startsWith(`${hrefPath}/`);

  const base = tone === 'sidebar' ? 'kh-sidebar-link' : 'kh-nav-link';
  const activeBase =
    tone === 'sidebar' ? 'kh-sidebar-link-active' : 'kh-nav-link-active';

  return (
    <Link
      href={href}
      className={cn(base, active && (activeClassName ?? activeBase), className)}
      aria-current={active ? 'page' : undefined}
      {...props}
    >
      {children}
    </Link>
  );
}
