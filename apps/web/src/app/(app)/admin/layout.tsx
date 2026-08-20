import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { requireSession } from '../../../lib/session';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();
  if (!session.user.isSystemAdmin) {
    redirect('/dashboard');
  }

  return <div className="min-w-0">{children}</div>;
}
