'use client';

import { Suspense, type ReactNode } from 'react';
import type { ThemePreference } from '../../lib/theme';
import type { SessionPayload } from '../../lib/session';
import { AppRail, useRailChromeState, type ShellWorkspace } from './AppRail';
import { AppTopBar } from './AppTopBar';
import { ProjectRailProvider } from './ProjectRailContext';
import { ShellCrumbProvider } from './ShellCrumbContext';

export function OpsAppShell({
  session,
  workspaces,
  themePreference,
  children,
}: {
  session: SessionPayload;
  workspaces: ShellWorkspace[];
  themePreference: ThemePreference;
  children: ReactNode;
}) {
  const { compact, setCompact, open, setOpen } = useRailChromeState();

  return (
    <ProjectRailProvider>
      <ShellCrumbProvider>
        <div
          className="kh-ops-shell"
          data-rail-compact={compact ? 'true' : 'false'}
          data-rail-open={open ? 'true' : 'false'}
        >
          <Suspense fallback={<div className="kh-ops-rail" aria-hidden />}>
            <AppRail
              session={session}
              workspaces={workspaces}
              compact={compact}
              onCompactChange={setCompact}
              open={open}
              onOpenChange={setOpen}
            />
          </Suspense>
          <div className="kh-ops-content">
            <Suspense fallback={<header className="kh-ops-subhead" aria-hidden />}>
              <AppTopBar
                workspaces={workspaces}
                isAdmin={session.user.isSystemAdmin}
                themePreference={themePreference}
                onOpenRail={() => setOpen(true)}
              />
            </Suspense>
            <div className="kh-ops-view">{children}</div>
          </div>
        </div>
      </ShellCrumbProvider>
    </ProjectRailProvider>
  );
}
