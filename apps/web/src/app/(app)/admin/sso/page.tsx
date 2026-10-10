import { redirect } from 'next/navigation';

export default function AdminSsoPage() {
  redirect('/admin/identity?tab=sso');
}
