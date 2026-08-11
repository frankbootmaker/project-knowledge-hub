'use client';

import type { FormEvent } from 'react';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { parseOptionalNumber } from '../../../../../../lib/project-currency';
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
  const [version, setVersion] = useState('');
  const [criticality, setCriticality] = useState('');
  const [primaryUrl, setPrimaryUrl] = useState('');
  const [hostname, setHostname] = useState('');
  const [vendor, setVendor] = useState('');
  const [deploymentModel, setDeploymentModel] = useState('');
  const [supportContact, setSupportContact] = useState('');
  const [documentationUrl, setDocumentationUrl] = useState('');
  const [dataClassification, setDataClassification] = useState('');
  const [itCostMode, setItCostMode] = useState('');
  const [itFlatMonthlyFee, setItFlatMonthlyFee] = useState('');
  const [itOneTimeCost, setItOneTimeCost] = useState('');
  const [itBudgetAllocation, setItBudgetAllocation] = useState('');
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
          version: version || undefined,
          criticality: criticality || undefined,
          itDetails: {
            ...(primaryUrl.trim() ? { primaryUrl: primaryUrl.trim() } : {}),
            ...(hostname.trim() ? { hostname: hostname.trim() } : {}),
            ...(vendor.trim() ? { vendor: vendor.trim() } : {}),
            ...(deploymentModel ? { deploymentModel } : {}),
            ...(supportContact.trim()
              ? { supportContact: supportContact.trim() }
              : {}),
            ...(documentationUrl.trim()
              ? { documentationUrl: documentationUrl.trim() }
              : {}),
            ...(dataClassification ? { dataClassification } : {}),
          },
          ...(systemType.trim() !== 'ai_assistant'
            ? {
                itCostMode: itCostMode || undefined,
                itFlatMonthlyFee: parseOptionalNumber(itFlatMonthlyFee),
                itOneTimeCost: parseOptionalNumber(itOneTimeCost),
                itBudgetAllocation: parseOptionalNumber(itBudgetAllocation),
              }
            : {}),
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
      <p className="mt-0 mb-6">
        <Link
          href={`/workspaces/${workspaceSlug}`}
          className="text-sm text-ink-muted no-underline hover:text-ink"
        >
          {t('backToWorkspace')}
        </Link>
      </p>
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
          <Field label={t('version')}>
            <Input value={version} onChange={(e) => setVersion(e.target.value)} />
          </Field>
          <Field label={t('criticality')}>
            <Select
              value={criticality}
              onChange={(e) => setCriticality(e.target.value)}
            >
              <option value="">{t('criticalityUnset')}</option>
              <option value="low">{t('criticalityOption.low')}</option>
              <option value="medium">{t('criticalityOption.medium')}</option>
              <option value="high">{t('criticalityOption.high')}</option>
              <option value="critical">{t('criticalityOption.critical')}</option>
            </Select>
          </Field>
          <div className="grid gap-3 rounded-md border border-line p-3">
            <div>
              <p className="m-0 text-sm font-medium">{t('itSection')}</p>
              <p className="mt-1 mb-0 text-xs text-ink-muted">{t('itSectionHint')}</p>
            </div>
            <Field label={t('primaryUrl')}>
              <Input
                value={primaryUrl}
                onChange={(e) => setPrimaryUrl(e.target.value)}
              />
            </Field>
            <Field label={t('hostname')}>
              <Input
                value={hostname}
                onChange={(e) => setHostname(e.target.value)}
              />
            </Field>
            <Field label={t('vendor')}>
              <Input value={vendor} onChange={(e) => setVendor(e.target.value)} />
            </Field>
            <Field label={t('deploymentModel')}>
              <Select
                value={deploymentModel}
                onChange={(e) => setDeploymentModel(e.target.value)}
              >
                <option value="">{t('deploymentUnset')}</option>
                {(
                  [
                    'saas',
                    'paas',
                    'iaas',
                    'on_prem',
                    'vm',
                    'container',
                    'kubernetes',
                    'network',
                    'endpoint',
                    'other',
                  ] as const
                ).map((value) => (
                  <option key={value} value={value}>
                    {t(`deploymentOption.${value}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('dataClassification')}>
              <Select
                value={dataClassification}
                onChange={(e) => setDataClassification(e.target.value)}
              >
                <option value="">{t('dataClassUnset')}</option>
                <option value="public">{t('dataClassOption.public')}</option>
                <option value="internal">{t('dataClassOption.internal')}</option>
                <option value="confidential">
                  {t('dataClassOption.confidential')}
                </option>
                <option value="restricted">
                  {t('dataClassOption.restricted')}
                </option>
              </Select>
            </Field>
            <Field label={t('supportContact')}>
              <Input
                value={supportContact}
                onChange={(e) => setSupportContact(e.target.value)}
              />
            </Field>
            <Field label={t('documentationUrl')}>
              <Input
                value={documentationUrl}
                onChange={(e) => setDocumentationUrl(e.target.value)}
              />
            </Field>
          </div>
          {systemType.trim() !== 'ai_assistant' ? (
            <div className="grid gap-3 rounded-md border border-line p-3">
              <div>
                <p className="m-0 text-sm font-medium">{t('itCostSection')}</p>
                <p className="mt-1 mb-0 text-xs text-ink-muted">
                  {t('itCostSectionHint')}
                </p>
              </div>
              <Field label={t('itCostModeLabel')}>
                <Select
                  value={itCostMode}
                  onChange={(e) => setItCostMode(e.target.value)}
                >
                  <option value="">{t('itCostModeUnset')}</option>
                  <option value="flat">{t('itCostMode.flat')}</option>
                  <option value="one_time">{t('itCostMode.one_time')}</option>
                  <option value="note_only">{t('itCostMode.note_only')}</option>
                </Select>
              </Field>
              <Field label={t('itFlatMonthlyFee')}>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={itFlatMonthlyFee}
                  onChange={(e) => setItFlatMonthlyFee(e.target.value)}
                  placeholder={t('itFlatMonthlyFeePlaceholder')}
                />
              </Field>
              <Field label={t('itOneTimeCost')}>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={itOneTimeCost}
                  onChange={(e) => setItOneTimeCost(e.target.value)}
                  placeholder={t('itOneTimeCostPlaceholder')}
                />
              </Field>
              <Field label={t('itBudgetAllocation')}>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={itBudgetAllocation}
                  onChange={(e) => setItBudgetAllocation(e.target.value)}
                  placeholder={t('itBudgetAllocationPlaceholder')}
                />
              </Field>
            </div>
          ) : null}
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
