import { getTranslations } from 'next-intl/server';
import {
  StylePacksAdmin,
  type PublicStylePack,
} from '../../../../components/admin/StylePacksAdmin';
import { PageHeader } from '../../../../components/ui';
import { apiFetch } from '../../../../lib/session';

export default async function AdminTemplatesPage() {
  const t = await getTranslations('admin');
  const response = await apiFetch(
    '/api/v1/admin/doc-factory/style-packs?includeArchived=true',
  );
  const payload = response.ok
    ? ((await response.json()) as {
        organizationId: string;
        stylePacks: PublicStylePack[];
      })
    : {
        organizationId: '',
        stylePacks: [
          {
            id: 'blank',
            organizationId: null,
            slug: 'blank',
            label: 'Blank',
            status: 'active' as const,
            formats: ['pdf' as const, 'docx' as const],
            typography: {},
            chrome: {},
            hasLogo: false,
            logoContentType: null,
            hasDocxTemplate: false,
            docxTemplateContentType: null,
            docxTemplateBodyAnchor: null,
            createdAt: null,
            updatedAt: null,
            builtin: true,
          },
        ],
      };

  return (
    <div>
      <PageHeader
        title={t('templates')}
        description={t('templatesPageBlurb')}
      />
      {payload.organizationId ? (
        <StylePacksAdmin
          organizationId={payload.organizationId}
          initialPacks={payload.stylePacks}
        />
      ) : (
        <p className="text-sm text-ink-muted">{t('templatesNoOrganization')}</p>
      )}
    </div>
  );
}
