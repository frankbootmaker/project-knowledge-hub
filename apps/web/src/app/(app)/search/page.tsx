import { RECORD_TYPE_CATALOG } from '@project-knowledge-hub/domain';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import {
  Badge,
  Button,
  ErrorText,
  Field,
  Input,
  Page,
  PageHeader,
  Select,
  lifecycleLabel,
  lifecycleTone,
} from '../../../components/ui';
import { localeLabels, locales } from '../../../i18n/config';
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
  const language = typeof params.language === 'string' ? params.language : '';
  const verifiedOnly = params.verifiedOnly === 'true';
  const currentOnly = params.currentOnly === 'true';
  const includeHistorical = params.includeHistorical === 'true';
  const hybrid = params.hybrid === 'true';

  const [workspacesResponse, capabilitiesResponse] = await Promise.all([
    apiFetch('/api/v1/workspaces'),
    apiFetch('/api/v1/search/capabilities'),
  ]);
  const workspaces = workspacesResponse.ok
    ? ((await workspacesResponse.json()) as { workspaces: Workspace[] }).workspaces
    : [];
  const hybridAvailable = capabilitiesResponse.ok
    ? Boolean(
        (
          (await capabilitiesResponse.json()) as { hybridAvailable?: boolean }
        ).hybridAvailable,
      )
    : false;

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
    if (language) searchUrl.set('language', language);
    if (verifiedOnly) searchUrl.set('verifiedOnly', 'true');
    if (currentOnly) searchUrl.set('currentOnly', 'true');
    if (includeHistorical) searchUrl.set('includeHistorical', 'true');
    if (hybrid && hybridAvailable) searchUrl.set('mode', 'hybrid');

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

      <section className="kh-ops-panel mb-6">
        <div className="kh-ops-card-body">
        <form method="get" className="grid gap-4">
          <Field label={t('query')}>
            <Input
              name="q"
              defaultValue={query}
              required
              placeholder={t('queryPlaceholder')}
            />
          </Field>

          <div className="kh-ops-form-grid">
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
            <Field label={t('language')}>
              <Select name="language" defaultValue={language}>
                <option value="">{tCommon('any')}</option>
                {locales.map((code) => (
                  <option key={code} value={code}>
                    {localeLabels[code]} ({code})
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

          <div className="kh-ops-scope-checks">
            <label className="kh-ops-scope-check">
              <input
                type="checkbox"
                name="verifiedOnly"
                value="true"
                defaultChecked={verifiedOnly}
              />
              {t('verifiedOnly')}
            </label>
            <label className="kh-ops-scope-check">
              <input
                type="checkbox"
                name="currentOnly"
                value="true"
                defaultChecked={currentOnly}
              />
              {t('currentOnly')}
            </label>
            <label className="kh-ops-scope-check">
              <input
                type="checkbox"
                name="includeHistorical"
                value="true"
                defaultChecked={includeHistorical}
              />
              {t('includeHistorical')}
            </label>
            {hybridAvailable ? (
              <label className="kh-ops-scope-check">
                <input
                  type="checkbox"
                  name="hybrid"
                  value="true"
                  defaultChecked={hybrid}
                />
                {t('hybridSearch')}
              </label>
            ) : null}
          </div>

          <div className="kh-ops-action-line px-0">
            <span className="kh-ops-panel-meta">{t('title')}</span>
            <Button type="submit">{t('searchButton')}</Button>
          </div>
        </form>
        </div>
      </section>

      {searchError ? <ErrorText>{searchError}</ErrorText> : null}

      {query ? (
        <div className="mt-6 grid gap-4">
          {results.length === 0 && !searchError ? (
            <p className="kh-ops-empty">{t('noMatches')}</p>
          ) : null}
          {Object.entries(
            results.reduce<Record<string, SearchResult[]>>((groups, result) => {
              const key = result.recordType || 'other';
              groups[key] = groups[key] ?? [];
              groups[key].push(result);
              return groups;
            }, {}),
          ).map(([recordTypeKey, group]) => (
            <section key={recordTypeKey} className="kh-ops-search-group kh-ops-panel">
              <div className="kh-ops-panel-head">
                <h2 className="kh-ops-panel-title">{recordTypeKey}</h2>
                <span className="kh-ops-panel-meta">{group.length}</span>
              </div>
              <div className="kh-ops-table-wrap">
                <table className="kh-ops-data-table">
                  <thead>
                    <tr>
                      <th>{t('colTitle')}</th>
                      <th>{t('colType')}</th>
                      <th>{t('colLifecycle')}</th>
                      <th>{t('colProject')}</th>
                      <th>{t('colUpdated')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.map((result) => {
                      const href = activeWorkspace
                        ? `/workspaces/${activeWorkspace.slug}/records/${result.slug}`
                        : '#';
                      return (
                        <tr key={result.id}>
                          <td className="kh-ops-primary-cell">
                            <Link href={href} className="no-underline">
                              {result.title}
                            </Link>
                            {result.excerpt ? (
                              <div className="max-w-[28rem] truncate text-[11px] font-normal text-ink-muted">
                                {result.excerpt}
                              </div>
                            ) : null}
                          </td>
                          <td>
                            <span className="kh-ops-type-chip">
                              {result.recordType}
                            </span>
                          </td>
                          <td>
                            <Badge tone={lifecycleTone(result.lifecycleStatus)}>
                              {lifecycleLabel(result.lifecycleStatus, tRecords)}
                            </Badge>
                          </td>
                          <td>{result.project?.name ?? '—'}</td>
                          <td>
                            {new Date(result.updatedAt).toLocaleDateString()}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      ) : null}
    </Page>
  );
}
