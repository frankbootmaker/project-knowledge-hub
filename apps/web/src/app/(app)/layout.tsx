import { redirect } from 'next/navigation';
import { Suspense, type ReactNode } from 'react';
import { OpsAppShell } from '../../components/ops/OpsAppShell';
import { apiFetch, getSession } from '../../lib/session';
import { getThemePreference } from '../../lib/theme-actions';

export default async function AppShellLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }

  const [themePreference, workspacesResponse] = await Promise.all([
    getThemePreference(),
    apiFetch('/api/v1/workspaces'),
  ]);
  const workspaces = workspacesResponse.ok
    ? (
        (await workspacesResponse.json()) as {
          workspaces: Array<{ id: string; slug: string; name: string }>;
        }
      ).workspaces
    : [];

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
