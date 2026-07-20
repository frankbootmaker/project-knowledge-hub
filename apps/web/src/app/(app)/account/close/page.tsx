import { getTranslations } from 'next-intl/server';
import { CloseAccountPanel } from '../../../../components/CloseAccountPanel';
import { PageHeader } from '../../../../components/ui';
import { requireSession } from '../../../../lib/session';

export default async function AccountClosePage() {
  await requireSession();
  const t = await getTranslations('profile');

  return (
    <div>
      <PageHeader title={t('closeTitle')} description={t('closeBlurb')} />
      <CloseAccountPanel />
    </div>
  );
}
