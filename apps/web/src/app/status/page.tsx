import { redirect } from 'next/navigation';

/** Status folded into Admin → Monitoring (NF-011). */
export default function StatusRedirectPage() {
  redirect('/admin/monitoring');
}
