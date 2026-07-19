import { getTranslations } from 'next-intl/server';
import { ArchivedItemsSections } from '../../../../components/ArchivedItemsSections';
import { PageHeader } from '../../../../components/ui';
import { loadArchivedListings } from '../../../../lib/archive-listings';
import { requireSession } from '../../../../lib/session';

export default async function AdminArchivePage() {
  const session = await requireSession();
  const t = await getTranslations('archive');
  const tAdmin = await getTranslations('admin');
  const listings = await loadArchivedListings();

  return (
    <div>
      <PageHeader title={tAdmin('archive')} description={t('adminBlurb')} />
      <ArchivedItemsSections
        session={session}
        listings={listings}
        showWorkspaces
      />
    </div>
  );
}
