'use client';

import type { FormEvent } from 'react';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  Button,
  ErrorText,
  Field,
  Input,
  Page,
  PageHeader,
  Panel,
  Select,
  Textarea,
} from '../../../../../../components/ui';

type ProjectOption = { id: string; name: string };

export default function NewSystemPage() {
  const router = useRouter();
  const params = useParams<{ slug: string }>();
  const workspaceSlug = params.slug;
  const t = useTranslations('systems');
  const tWorkspaces = useTranslations('workspaces');
  const tCommon = useTranslations('common');

  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [name, setName] = useState('');
  const [summary, setSummary] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState('active');
  const [projectId, setProjectId] = useState('');
  const [systemType, setSystemType] = useState('');
  const [environment, setEnvironment] = useState('');
  const [tags, setTags] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    async function loadProjects() {
      const workspacesResponse = await fetch('/api/v1/workspaces', { credentials: 'include' });
      const workspacesPayload = (await workspacesResponse.json()) as {
        workspaces: Array<{ id: string; slug: string }>;
      };
      const workspace = workspacesPayload.workspaces.find((item) => item.slug === workspaceSlug);
      if (!workspace) {
        return;
      }
      const projectsResponse = await fetch(`/api/v1/projects?workspaceId=${workspace.id}`, {
        credentials: 'include',
      });
      if (!projectsResponse.ok) {
        return;
      }
      const projectsPayload = (await projectsResponse.json()) as {
        projects: ProjectOption[];
      };
      setProjects(projectsPayload.projects);
    }
    void loadProjects();
  }, [workspaceSlug]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      const workspacesResponse = await fetch('/api/v1/workspaces', { credentials: 'include' });
      const workspacesPayload = (await workspacesResponse.json()) as {
        workspaces: Array<{ id: string; slug: string }>;
      };
      const workspace = workspacesPayload.workspaces.find((item) => item.slug === workspaceSlug);
      if (!workspace) {
        throw new Error(tWorkspaces('notFound'));
      }

      const response = await fetch('/api/v1/systems', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId: workspace.id,
          projectId: projectId || null,
          name,
          summary: summary || undefined,
          description: description || undefined,
          status,
          systemType: systemType || undefined,
          environment: environment || undefined,
          tags: tags
            .split(',')
            .map((tag) => tag.trim())
            .filter(Boolean),
        }),
      });
      const payload = (await response.json()) as {
        system?: { slug: string };
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? t('failedCreate'));
      }
      router.push(`/workspaces/${workspaceSlug}/systems/${payload.system?.slug ?? ''}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('failedCreate'));
    } finally {
      setPending(false);
    }
  }

  return (
    <Page narrow>
      <PageHeader title={t('createTitle')} />
      <Panel>
        <form onSubmit={onSubmit} className="grid gap-4">
          <Field label={tCommon('name')}>
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <Field label={t('projectOptional')}>
            <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">{t('independentNoProject')}</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={tCommon('summary')}>
            <Input value={summary} onChange={(e) => setSummary(e.target.value)} />
          </Field>
          <Field label={tCommon('description')}>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} />
          </Field>
          <Field label={tCommon('status')}>
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="proposed">proposed</option>
              <option value="experimental">experimental</option>
              <option value="active">active</option>
              <option value="degraded">degraded</option>
              <option value="maintenance">maintenance</option>
              <option value="deprecated">deprecated</option>
              <option value="retired">retired</option>
              <option value="archived">archived</option>
            </Select>
          </Field>
          <Field label={t('systemType')}>
            <Input value={systemType} onChange={(e) => setSystemType(e.target.value)} />
          </Field>
          <Field label={t('environment')}>
            <Input value={environment} onChange={(e) => setEnvironment(e.target.value)} />
          </Field>
          <Field label={tCommon('tagsHint')}>
            <Input value={tags} onChange={(e) => setTags(e.target.value)} />
          </Field>
          {error ? <ErrorText>{error}</ErrorText> : null}
          <Button type="submit" disabled={pending}>
            {pending ? t('creating') : t('createButton')}
          </Button>
        </form>
      </Panel>
    </Page>
  );
}
