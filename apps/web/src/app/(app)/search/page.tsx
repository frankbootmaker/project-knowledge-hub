import { RECORD_TYPE_CATALOG } from '@project-knowledge-hub/domain';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import {
  Badge,
  Button,
  ErrorText,
  Field,
  Input,
  ListCard,
  Page,
  PageHeader,
  Panel,
  SectionHeader,
  Select,
  lifecycleTone,
} from '../../../components/ui';
import { apiFetch, requireSession } from '../../../lib/session';

type Workspace = { id: string; slug: string; name: string };
type Project = { id: string; name: string };
type System = { id: string; name: string };

type SearchResult = {
  id: string;
  title: string;
  slug: string;
  summary: string | null;
  recordType: string;
  lifecycleStatus: string;
  verified: boolean;
  excerpt: string;
  score: number;
  project: { id: string; name: string | null; slug: string | null } | null;
  system: { id: string; name: string | null; slug: string | null } | null;
  tags: string[];
  updatedAt: string;
};

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireSession();
  const t = await getTranslations('search');
  const tCommon = await getTranslations('common');
  const tRecords = await getTranslations('records');
  const params = await searchParams;

  const query = typeof params.q === 'string' ? params.q : '';
  const workspaceId = typeof params.workspaceId === 'string' ? params.workspaceId : '';
  const projectId = typeof params.projectId === 'string' ? params.projectId : '';
  const systemId = typeof params.systemId === 'string' ? params.systemId : '';
  const recordType = typeof params.recordType === 'string' ? params.recordType : '';
  const verifiedOnly = params.verifiedOnly === 'true';
  const currentOnly = params.currentOnly === 'true';
  const includeHistorical = params.includeHistorical === 'true';

  const workspacesResponse = await apiFetch('/api/v1/workspaces');
  const workspaces = workspacesResponse.ok
    ? ((await workspacesResponse.json()) as { workspaces: Workspace[] }).workspaces
    : [];

  const activeWorkspaceId = workspaceId || workspaces[0]?.id || '';
  const activeWorkspace = workspaces.find((item) => item.id === activeWorkspaceId);

  let projects: Project[] = [];
  let systems: System[] = [];
  if (activeWorkspaceId) {
    const [projectsResponse, systemsResponse] = await Promise.all([
      apiFetch(`/api/v1/projects?workspaceId=${activeWorkspaceId}`),
      apiFetch(`/api/v1/systems?workspaceId=${activeWorkspaceId}`),
    ]);
    projects = projectsResponse.ok
      ? ((await projectsResponse.json()) as { projects: Project[] }).projects
      : [];
    systems = systemsResponse.ok
      ? ((await systemsResponse.json()) as { systems: System[] }).systems
      : [];
  }

  let results: SearchResult[] = [];
  let searchError: string | null = null;

  if (query && activeWorkspaceId) {
    const searchUrl = new URLSearchParams({
      workspaceId: activeWorkspaceId,
      query,
      limit: '30',
    });
    if (projectId) searchUrl.set('projectId', projectId);
    if (systemId) searchUrl.set('systemId', systemId);
    if (recordType) searchUrl.set('recordTypes', recordType);
    if (verifiedOnly) searchUrl.set('verifiedOnly', 'true');
    if (currentOnly) searchUrl.set('currentOnly', 'true');
    if (includeHistorical) searchUrl.set('includeHistorical', 'true');

    const searchResponse = await apiFetch(`/api/v1/search?${searchUrl.toString()}`);
    if (searchResponse.ok) {
      results = ((await searchResponse.json()) as { results: SearchResult[] }).results;
    } else {
      const payload = (await searchResponse.json()) as { error?: { message?: string } };
      searchError = payload.error?.message ?? t('failed');
    }
  }

  return (
    <Page wide>
      <PageHeader title={t('title')} description={t('subtitle')} />

      <Panel className="mb-6">
        <form method="get" className="grid gap-4">
          <Field label={t('query')}>
            <Input
              name="q"
              defaultValue={query}
              required
              placeholder={t('queryPlaceholder')}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('workspace')}>
              <Select name="workspaceId" defaultValue={activeWorkspaceId}>
                {workspaces.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>
                    {workspace.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('recordType')}>
              <Select name="recordType" defaultValue={recordType}>
                <option value="">{tCommon('any')}</option>
                {RECORD_TYPE_CATALOG.map((entry) => (
                  <option key={entry.value} value={entry.value}>
                    {tRecords(`typeLabels.${entry.value}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={tCommon('project')}>
              <Select name="projectId" defaultValue={projectId}>
                <option value="">{tCommon('any')}</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={tCommon('system')}>
              <Select name="systemId" defaultValue={systemId}>
                <option value="">{tCommon('any')}</option>
                {systems.map((system) => (
                  <option key={system.id} value={system.id}>
                    {system.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="flex flex-wrap gap-4 text-sm text-ink">
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                name="verifiedOnly"
                value="true"
                defaultChecked={verifiedOnly}
              />
              {t('verifiedOnly')}
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                name="currentOnly"
                value="true"
                defaultChecked={currentOnly}
              />
              {t('currentOnly')}
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                name="includeHistorical"
                value="true"
                defaultChecked={includeHistorical}
              />
              {t('includeHistorical')}
            </label>
          </div>

          <Button type="submit" className="justify-self-start">
            {t('searchButton')}
          </Button>
        </form>
      </Panel>

      {searchError ? <ErrorText>{searchError}</ErrorText> : null}

      {query ? (
        <section className="mt-6">
          <SectionHeader
            title={results.length ? t('resultsCount', { count: results.length }) : t('results')}
          />
          <ul className="m-0 grid list-none gap-3 p-0">
            {results.map((result) => {
              const href = activeWorkspace
                ? `/workspaces/${activeWorkspace.slug}/records/${result.slug}`
                : '#';
              return (
                <ListCard key={result.id}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <Link href={href} className="font-semibold no-underline">
                        {result.title}
                      </Link>
                      <p className="mt-1 mb-0 text-sm text-ink-muted">
                        {result.recordType}
                        {result.project?.name ? ` · ${result.project.name}` : ''}
                        {result.system?.name ? ` · ${result.system.name}` : ''}
                      </p>
                    </div>
                    <Badge tone={lifecycleTone(result.lifecycleStatus)}>
                      {result.lifecycleStatus}
                    </Badge>
                  </div>
                  {result.excerpt ? (
                    <p className="mt-3 mb-0 text-sm text-ink-muted">{result.excerpt}</p>
                  ) : null}
                  {result.tags.length > 0 ? (
                    <p className="mt-2 mb-0 text-xs text-ink-muted">
                      {t('tagsLabel', { tags: result.tags.join(', ') })}
                    </p>
                  ) : null}
                </ListCard>
              );
            })}
            {results.length === 0 && !searchError ? (
              <li className="kh-muted list-none">{t('noMatches')}</li>
            ) : null}
          </ul>
        </section>
      ) : null}
    </Page>
  );
}
