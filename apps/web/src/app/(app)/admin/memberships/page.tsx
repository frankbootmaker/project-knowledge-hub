import { redirect } from 'next/navigation';

export default function AdminMembershipsPage() {
  redirect('/admin/identity?tab=memberships');
}
