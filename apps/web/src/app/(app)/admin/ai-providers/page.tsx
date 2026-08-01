import { getTranslations } from 'next-intl/server';
import {
  AiProvidersAdmin,
  type PublicLlmBinding,
  type PublicLlmProvider,
} from '../../../../components/admin/AiProvidersAdmin';
import { PageHeader } from '../../../../components/ui';
import { apiFetch } from '../../../../lib/session';

export default async function AdminAiProvidersPage() {
  const t = await getTranslations('admin');
  const response = await apiFetch('/api/v1/admin/llm-providers');
  const body = response.ok
    ? ((await response.json()) as {
        providers: PublicLlmProvider[];
        bindings: PublicLlmBinding[];
      })
    : { providers: [], bindings: [] };

  return (
    <div>
      <PageHeader
        title={t('aiProviders')}
        description={t('aiProvidersPageBlurb')}
      />
      <AiProvidersAdmin
        initialProviders={body.providers}
        initialBindings={body.bindings}
      />
    </div>
  );
}
