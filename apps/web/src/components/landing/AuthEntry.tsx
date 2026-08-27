'use client';

import type { ThemePreference } from '../../lib/theme';
import type { AuthMode } from './auth-mode';
import { LandingPage } from './LandingPage';
import { MobileAuthPage } from './MobileAuthPage';
import { useIsDesktopAuth } from './useIsDesktopAuth';

export function AuthEntry({
  mode,
  themePreference,
}: {
  mode: AuthMode;
  themePreference: ThemePreference;
}) {
  const isDesktop = useIsDesktopAuth();

  if (isDesktop === null) {
    return <div className="kh-ops-auth-page" aria-busy="true" />;
  }

  if (isDesktop) {
    return (
      <LandingPage
        themePreference={themePreference}
        initialAuthMode={mode}
      />
    );
  }

  return <MobileAuthPage mode={mode} />;
}
