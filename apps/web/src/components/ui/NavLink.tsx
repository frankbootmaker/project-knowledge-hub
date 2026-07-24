'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ComponentProps, type ReactNode } from 'react';
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

function splitHref(href: Props['href']): { path: string; hash: string } {
  if (typeof href !== 'string') {
    return { path: href.pathname || '', hash: href.hash?.replace(/^#/, '') ?? '' };
  }
  const [path = '', hash = ''] = href.split('#');
  return { path: path.split('?')[0] ?? '', hash };
}

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
  const { path: hrefPath, hash: hrefHash } = splitHref(href);
  const [currentHash, setCurrentHash] = useState('');

  useEffect(() => {
    if (!hrefHash) {
      return;
    }
    const sync = () => setCurrentHash(window.location.hash.replace(/^#/, ''));
    sync();
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, [hrefHash, pathname]);

  const pathActive = exact
    ? pathname === hrefPath
    : hrefPath === '/'
      ? pathname === '/'
      : pathname === hrefPath || pathname.startsWith(`${hrefPath}/`);
  const active = pathActive && (!hrefHash || currentHash === hrefHash);

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
