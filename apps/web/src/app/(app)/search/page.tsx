import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
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

function statusStyle(status: string): { background: string; color: string } {
  if (status === 'current' || status === 'verified') {
    return { background: '#e3f6ec', color: '#145a36' };
  }
  if (status === 'draft') {
    return { background: '#f3f4f6', color: '#374151' };
  }
  if (status === 'review_required') {
    return { background: '#fff7e6', color: '#8a5a00' };
  }
  return { background: '#eef2f7', color: '#1f4b73' };
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireSession();
  const t = await getTranslations('search');
  const tCommon = await getTranslations('common');
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
    <main style={{ maxWidth: 960, margin: '0 auto' }}>
      <h1 style={{ marginBottom: '0.35rem' }}>{t('title')}</h1>
      <p style={{ opacity: 0.7, marginTop: 0 }}>{t('subtitle')}</p>

      <form
        method="get"
        style={{
          marginTop: '1.25rem',
          padding: '1.1rem',
          background: 'rgba(255,255,255,0.72)',
          border: '1px solid rgba(21,32,43,0.08)',
          display: 'grid',
          gap: '0.75rem',
        }}
      >
        <label style={{ display: 'grid', gap: '0.35rem' }}>
          <span>{t('query')}</span>
          <input
            name="q"
            defaultValue={query}
            required
            placeholder={t('queryPlaceholder')}
            style={{ padding: '0.7rem' }}
          />
        </label>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <label style={{ display: 'grid', gap: '0.35rem' }}>
            <span>{t('workspace')}</span>
            <select name="workspaceId" defaultValue={activeWorkspaceId} style={{ padding: '0.65rem' }}>
              {workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'grid', gap: '0.35rem' }}>
            <span>{t('recordType')}</span>
            <select name="recordType" defaultValue={recordType} style={{ padding: '0.65rem' }}>
              <option value="">{tCommon('any')}</option>
              <option value="deployment-guide">deployment-guide</option>
              <option value="configuration">configuration</option>
              <option value="configuration-snapshot">configuration-snapshot</option>
              <option value="runbook">runbook</option>
              <option value="architecture">architecture</option>
              <option value="overview">overview</option>
              <option value="troubleshooting">troubleshooting</option>
            </select>
          </label>
          <label style={{ display: 'grid', gap: '0.35rem' }}>
            <span>{tCommon('project')}</span>
            <select name="projectId" defaultValue={projectId} style={{ padding: '0.65rem' }}>
              <option value="">{tCommon('any')}</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'grid', gap: '0.35rem' }}>
            <span>{tCommon('system')}</span>
            <select name="systemId" defaultValue={systemId} style={{ padding: '0.65rem' }}>
              <option value="">{tCommon('any')}</option>
              {systems.map((system) => (
                <option key={system.id} value={system.id}>
                  {system.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
            <input type="checkbox" name="verifiedOnly" value="true" defaultChecked={verifiedOnly} />
            {t('verifiedOnly')}
          </label>
          <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
            <input type="checkbox" name="currentOnly" value="true" defaultChecked={currentOnly} />
            {t('currentOnly')}
          </label>
          <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
            <input
              type="checkbox"
              name="includeHistorical"
              value="true"
              defaultChecked={includeHistorical}
            />
            {t('includeHistorical')}
          </label>
        </div>

        <button
          type="submit"
          style={{
            justifySelf: 'start',
            padding: '0.7rem 1.1rem',
            border: 'none',
            background: '#1f4b73',
            color: 'white',
          }}
        >
          {t('searchButton')}
        </button>
      </form>

      {searchError ? <p style={{ color: '#9b1c1c' }}>{searchError}</p> : null}

      {query ? (
        <section style={{ marginTop: '1.75rem' }}>
          <h2 style={{ marginBottom: '0.75rem' }}>
            {results.length ? t('resultsCount', { count: results.length }) : t('results')}
          </h2>
          <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: '0.75rem' }}>
            {results.map((result) => {
              const badge = statusStyle(result.lifecycleStatus);
              const href = activeWorkspace
                ? `/workspaces/${activeWorkspace.slug}/records/${result.slug}`
                : '#';
              return (
                <li
                  key={result.id}
                  style={{
                    padding: '1rem',
                    background: 'rgba(255,255,255,0.72)',
                    border: '1px solid rgba(21,32,43,0.08)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
                    <div>
                      <Link href={href}>
                        <strong>{result.title}</strong>
                      </Link>
                      <div style={{ opacity: 0.7, marginTop: '0.25rem' }}>
                        {result.recordType}
                        {result.project?.name ? ` · ${result.project.name}` : ''}
                        {result.system?.name ? ` · ${result.system.name}` : ''}
                      </div>
                    </div>
                    <span
                      style={{
                        alignSelf: 'start',
                        padding: '0.2rem 0.5rem',
                        background: badge.background,
                        color: badge.color,
                        fontSize: '0.8rem',
                        fontWeight: 600,
                      }}
                    >
                      {result.lifecycleStatus}
                    </span>
                  </div>
                  {result.excerpt ? (
                    <p style={{ margin: '0.65rem 0 0', opacity: 0.85 }}>{result.excerpt}</p>
                  ) : null}
                  {result.tags.length > 0 ? (
                    <div style={{ marginTop: '0.45rem', opacity: 0.65, fontSize: '0.9rem' }}>
                      {t('tagsLabel', { tags: result.tags.join(', ') })}
                    </div>
                  ) : null}
                </li>
              );
            })}
            {results.length === 0 && !searchError ? (
              <li style={{ opacity: 0.75 }}>{t('noMatches')}</li>
            ) : null}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
