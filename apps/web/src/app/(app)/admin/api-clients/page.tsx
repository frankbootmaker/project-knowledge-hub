import { redirect } from 'next/navigation';

export default function AdminApiClientsPage() {
  redirect('/admin/mcp-setup?tab=clients');
}
