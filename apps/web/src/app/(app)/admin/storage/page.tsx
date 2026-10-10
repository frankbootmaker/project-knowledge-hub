import { redirect } from 'next/navigation';

export default function AdminStoragePage() {
  redirect('/admin/backups?tab=storage');
}
