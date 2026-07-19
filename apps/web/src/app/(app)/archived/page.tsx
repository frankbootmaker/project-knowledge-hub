import { getTranslations } from 'next-intl/server';
import { ArchivedItemsSections } from '../../../components/ArchivedItemsSections';
import { Page, PageHeader } from '../../../components/ui';
import { loadArchivedListings } from '../../../lib/archive-listings';
import { requireSession } from '../../../lib/session';

export default async function UserArchivedPage() {
  const session = await requireSession();
  const t = await getTranslations('archive');
  const listings = await loadArchivedListings();

  const showWorkspaces =
    session.user.isSystemAdmin ||
    session.memberships.some((membership) => membership.role === 'workspace_admin');

  return (
    <Page wide>
      <PageHeader title={t('navTitle')} description={t('userBlurb')} />
      <ArchivedItemsSections
        session={session}
        listings={listings}
        showWorkspaces={showWorkspaces}
      />
    </Page>
  );
}
