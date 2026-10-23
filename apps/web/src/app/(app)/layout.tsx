import { redirect } from 'next/navigation';
import { Suspense, type ReactNode } from 'react';
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

  return (
    <Suspense fallback={<div className="min-h-screen">{children}</div>}>
      <OpsAppShell
        session={session}
        workspaces={workspaces}
        themePreference={themePreference}
      >
        {children}
      </OpsAppShell>
    </Suspense>
  );
}
