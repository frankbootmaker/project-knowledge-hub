'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { cn } from '../../lib/cn';
import { NavLink } from '../ui';

export type AdminNavLink = {
  href: string;
  label: string;
  exact?: boolean;
};

export type AdminNavMonitoringSection = {
  hash: string;
  label: string;
};

type Props = {
  ariaLabel: string;
  links: AdminNavLink[];
  monitoringHref: string;
  monitoringSections: AdminNavMonitoringSection[];
};

function scrollToSection(hash: string): void {
  document.getElementById(hash)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export function AdminNav({
  ariaLabel,
  links,
  monitoringHref,
  monitoringSections,
}: Props) {
  const pathname = usePathname();
  const monitoringOpen =
    pathname === monitoringHref || pathname.startsWith(`${monitoringHref}/`);
  const [activeHash, setActiveHash] = useState('');

  useEffect(() => {
    setActiveHash(window.location.hash.replace(/^#/, ''));
  }, [pathname]);

  return (
    <nav className="grid gap-1" aria-label={ariaLabel}>
      {links.map((link) => {
        const isMonitoring = link.href === monitoringHref;

        if (!isMonitoring) {
          return (
            <NavLink
              key={link.href}
              href={link.href}
              tone="sidebar"
              exact={link.exact}
            >
              {link.label}
            </NavLink>
          );
        }

        return (
          <div key={link.href} className="grid gap-0.5">
            <NavLink href={link.href} tone="sidebar" exact={link.exact}>
              {link.label}
            </NavLink>
            {monitoringOpen ? (
              <div
                className="ml-2 grid gap-0.5 border-l border-line pl-2"
                role="group"
                aria-label={link.label}
              >
                {monitoringSections.map((section) => {
                  const href = `${monitoringHref}#${section.hash}`;
                  const active = activeHash === section.hash;
                  return (
                    <Link
                      key={section.hash}
                      href={href}
                      className={cn(
                        'kh-sidebar-link py-1.5 text-xs',
                        active && 'kh-sidebar-link-active',
                      )}
                      aria-current={active ? 'location' : undefined}
                      onClick={() => {
                        setActiveHash(section.hash);
                        // Next soft-nav may not fire hashchange; scroll explicitly.
                        window.setTimeout(() => scrollToSection(section.hash), 0);
                      }}
                    >
                      {section.label}
                    </Link>
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}
