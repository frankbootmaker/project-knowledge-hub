'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import type { AuthMode } from './auth-mode';
import { authPathForMode } from './auth-mode';

export function AuthNavLink({
  mode,
  onNavigate,
  children,
  className,
}: {
  mode: AuthMode;
  onNavigate?: (mode: AuthMode) => void;
  children: ReactNode;
  className?: string;
}) {
  if (onNavigate) {
    return (
      <button
        type="button"
        className={className ?? 'kh-lp-auth-text-btn'}
        onClick={() => onNavigate(mode)}
      >
        {children}
      </button>
    );
  }

  return (
    <Link href={authPathForMode(mode)} className={className}>
      {children}
    </Link>
  );
}
