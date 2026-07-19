import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AppHeader } from '../../components/AppHeader';
import { getSession } from '../../lib/session';

export default async function AppShellLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }

  return (
    <div className="min-h-screen">
      <AppHeader session={session} />
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{children}</div>
    </div>
  );
}
