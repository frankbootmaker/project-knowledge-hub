import { getTranslations } from 'next-intl/server';
import {
  OrganizationsAdmin,
  type PublicOrganization,
} from '../../../../components/admin/OrganizationsAdmin';
import { PageHeader } from '../../../../components/ui';
import { apiFetch } from '../../../../lib/session';

export default async function AdminOrganizationsPage() {
  const t = await getTranslations('admin');
  const response = await apiFetch('/api/v1/organizations');
  const organizations = response.ok
    ? ((await response.json()) as { organizations: PublicOrganization[] }).organizations
    : [];

  return (
    <div>
      <PageHeader title={t('organizations')} description={t('organizationsBlurb')} />
      <OrganizationsAdmin initialOrganizations={organizations} />
    </div>
  );
}
