import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { OpsAppShell } from '../../components/ops/OpsAppShell';
import { fetchWorkspaceList, getSession } from '../../lib/session';
import { getThemePreference } from '../../lib/theme-actions';

export default async function AppShellLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }

  const [themePreference, workspaces] = await Promise.all([
    getThemePreference(),
    fetchWorkspaceList(),
  ]);

  // Do not put {children} in a Suspense fallback. Next renders that fallback
  // as the static shell and then resumes the same page, and those two passes
  // do not share React cache(). The rail's search params suspend on their own.
  return (
    <OpsAppShell
      session={session}
      workspaces={workspaces}
      themePreference={themePreference}
    >
      {children}
    </OpsAppShell>
  );
}
