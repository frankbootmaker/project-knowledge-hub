import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AppHeader } from '../../components/AppHeader';
import { shellContentClassName } from '../../components/shell';
import { getSession } from '../../lib/session';

export default async function AppShellLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }

  return (
    <div className="min-h-screen">
      <AppHeader session={session} />
      <div className={shellContentClassName}>{children}</div>
    </div>
  );
}
