'use client';

import type { ReactNode } from 'react';
import type { ThemePreference } from '../../lib/theme';
import type { SessionPayload } from '../../lib/session';
import { AppRail, useRailChromeState, type ShellWorkspace } from './AppRail';
import { AppTopBar } from './AppTopBar';

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
    <div
      className="kh-ops-shell"
      data-rail-compact={compact ? 'true' : 'false'}
      data-rail-open={open ? 'true' : 'false'}
    >
      <AppRail
        session={session}
        workspaces={workspaces}
        compact={compact}
        onCompactChange={setCompact}
        open={open}
        onOpenChange={setOpen}
      />
      <div className="kh-ops-content">
        <AppTopBar
          workspaces={workspaces}
          isAdmin={session.user.isSystemAdmin}
          themePreference={themePreference}
          onOpenRail={() => setOpen(true)}
        />
        <div className="kh-ops-view">{children}</div>
      </div>
    </div>
  );
}
