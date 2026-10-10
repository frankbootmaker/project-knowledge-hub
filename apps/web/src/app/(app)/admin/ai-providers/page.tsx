import { redirect } from 'next/navigation';

export default function AdminAiProvidersPage() {
  redirect('/admin/mcp-setup?tab=providers');
}
