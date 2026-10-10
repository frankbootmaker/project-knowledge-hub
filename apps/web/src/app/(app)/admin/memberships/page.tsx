import { redirect } from 'next/navigation';

export default function AdminMembershipsPage() {
  redirect('/admin/mcp-setup?tab=memberships');
}
