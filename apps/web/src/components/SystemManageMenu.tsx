'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArchiveEntityButton } from './ArchiveEntityButton';
import { PurgeEntityButton } from './PurgeEntityButton';
import {
  ManageDetailRow,
  ManageMenuItem,
  ManageToolbar,
} from './manage-menu-shared';
import { parseOptionalNumber } from '../lib/project-currency';
import {
  Button,
  ErrorText,
  Field,
  Input,
  Modal,
  Select,
  Textarea,
  useToast,
} from './ui';

export type SystemItDetailsForm = {
  hostname?: string;
  primaryUrl?: string;
  vendor?: string;
  deploymentModel?: string;
  supportContact?: string;
  documentationUrl?: string;
  dataClassification?: string;
};

export type SystemManageDetails = {
  id: string;
  name: string;
  slug: string;
  status: string;
  summary: string | null;
  description: string | null;
  systemType: string | null;
  environment: string | null;
  version?: string | null;
  criticality?: string | null;
  itDetails?: SystemItDetailsForm | null;
  itCostMode?: 'flat' | 'one_time' | 'note_only' | null;
  itFlatMonthlyFee?: string | null;
  itOneTimeCost?: string | null;
  itBudgetAllocation?: string | null;
  projectId: string | null;
  tags: Array<{ name: string }>;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

const IT_COST_MODES = ['flat', 'one_time', 'note_only'] as const;
const AI_ASSISTANT_TYPE = 'ai_assistant';

const DEPLOYMENT_MODELS = [
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
] as const;

type ProjectOption = { id: string; name: string };

type Section = 'menu' | 'details' | 'edit' | 'archive' | 'delete';

export function SystemManageMenu(props: {
  workspaceSlug: string;
  system: SystemManageDetails;
  projects: ProjectOption[];
  canMutate: boolean;
  canPurge: boolean;
}) {
  const t = useTranslations('systems');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const { pushToast } = useToast();
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<Section>('menu');
  const [name, setName] = useState(props.system.name);
  const [summary, setSummary] = useState(props.system.summary ?? '');
  const [description, setDescription] = useState(props.system.description ?? '');
  const [status, setStatus] = useState(props.system.status);
  const [projectId, setProjectId] = useState(props.system.projectId ?? '');
  const [systemType, setSystemType] = useState(props.system.systemType ?? '');
  const [environment, setEnvironment] = useState(props.system.environment ?? '');
  const [version, setVersion] = useState(props.system.version ?? '');
  const [criticality, setCriticality] = useState(props.system.criticality ?? '');
  const [primaryUrl, setPrimaryUrl] = useState(
    props.system.itDetails?.primaryUrl ?? '',
  );
  const [hostname, setHostname] = useState(props.system.itDetails?.hostname ?? '');
  const [vendor, setVendor] = useState(props.system.itDetails?.vendor ?? '');
  const [deploymentModel, setDeploymentModel] = useState(
    props.system.itDetails?.deploymentModel ?? '',
  );
  const [supportContact, setSupportContact] = useState(
    props.system.itDetails?.supportContact ?? '',
  );
  const [documentationUrl, setDocumentationUrl] = useState(
    props.system.itDetails?.documentationUrl ?? '',
  );
  const [dataClassification, setDataClassification] = useState(
    props.system.itDetails?.dataClassification ?? '',
  );
  const [itCostMode, setItCostMode] = useState(props.system.itCostMode ?? '');
  const [itFlatMonthlyFee, setItFlatMonthlyFee] = useState(
    props.system.itFlatMonthlyFee != null ? String(props.system.itFlatMonthlyFee) : '',
  );
  const [itOneTimeCost, setItOneTimeCost] = useState(
    props.system.itOneTimeCost != null ? String(props.system.itOneTimeCost) : '',
  );
  const [itBudgetAllocation, setItBudgetAllocation] = useState(
    props.system.itBudgetAllocation != null
      ? String(props.system.itBudgetAllocation)
      : '',
  );
  const [tags, setTags] = useState(
    props.system.tags.map((tag) => tag.name).join(', '),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const archived = Boolean(props.system.archivedAt);
  const redirectParent = `/workspaces/${props.workspaceSlug}`;
  const showItCost = (systemType || props.system.systemType) !== AI_ASSISTANT_TYPE;

  useEffect(() => {
    setName(props.system.name);
    setSummary(props.system.summary ?? '');
    setDescription(props.system.description ?? '');
    setStatus(props.system.status);
    setProjectId(props.system.projectId ?? '');
    setSystemType(props.system.systemType ?? '');
    setEnvironment(props.system.environment ?? '');
    setVersion(props.system.version ?? '');
    setCriticality(props.system.criticality ?? '');
    setPrimaryUrl(props.system.itDetails?.primaryUrl ?? '');
    setHostname(props.system.itDetails?.hostname ?? '');
    setVendor(props.system.itDetails?.vendor ?? '');
    setDeploymentModel(props.system.itDetails?.deploymentModel ?? '');
    setSupportContact(props.system.itDetails?.supportContact ?? '');
    setDocumentationUrl(props.system.itDetails?.documentationUrl ?? '');
    setDataClassification(props.system.itDetails?.dataClassification ?? '');
    setItCostMode(props.system.itCostMode ?? '');
    setItFlatMonthlyFee(
      props.system.itFlatMonthlyFee != null
        ? String(props.system.itFlatMonthlyFee)
        : '',
    );
    setItOneTimeCost(
      props.system.itOneTimeCost != null ? String(props.system.itOneTimeCost) : '',
    );
    setItBudgetAllocation(
      props.system.itBudgetAllocation != null
        ? String(props.system.itBudgetAllocation)
        : '',
    );
    setTags(props.system.tags.map((tag) => tag.name).join(', '));
  }, [props.system]);

  function close() {
    setOpen(false);
    setSection('menu');
    setError(null);
  }

  function sectionTitle(): string {
    if (section === 'menu') return t('manageTitle');
    if (section === 'details') return t('manageDetails');
    if (section === 'edit') return t('manageEdit');
    if (section === 'delete') return t('manageDelete');
    return archived ? t('manageRestore') : t('manageArchive');
  }

  async function saveEdit() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/systems/${props.system.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Origin: window.location.origin,
        },
        body: JSON.stringify({
          name: name.trim(),
          summary: summary.trim() || null,
          description: description.trim() || null,
          status,
          projectId: projectId || null,
          systemType: systemType.trim() || null,
          environment: environment.trim() || null,
          version: version.trim() || null,
          criticality: criticality || null,
          itDetails: {
            ...(props.system.itDetails ?? {}),
            primaryUrl: primaryUrl.trim() || undefined,
            hostname: hostname.trim() || undefined,
            vendor: vendor.trim() || undefined,
            deploymentModel: deploymentModel || undefined,
            supportContact: supportContact.trim() || undefined,
            documentationUrl: documentationUrl.trim() || undefined,
            dataClassification: dataClassification || undefined,
          },
          ...(showItCost
            ? {
                itCostMode: itCostMode || null,
                itFlatMonthlyFee: parseOptionalNumber(itFlatMonthlyFee) ?? null,
                itOneTimeCost: parseOptionalNumber(itOneTimeCost) ?? null,
                itBudgetAllocation:
                  parseOptionalNumber(itBudgetAllocation) ?? null,
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
        throw new Error(payload.error?.message ?? t('failedUpdate'));
      }
      pushToast(t('updated'));
      const nextSlug = payload.system?.slug ?? props.system.slug;
      if (nextSlug !== props.system.slug) {
        router.push(`/workspaces/${props.workspaceSlug}/systems/${nextSlug}`);
      }
      router.refresh();
      setSection('menu');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('failedUpdate'));
    } finally {
      setPending(false);
    }
  }

  if (!props.canMutate && !props.canPurge) {
    return <ManageToolbar />;
  }

  return (
    <>
      <ManageToolbar>
        <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
          {t('manage')}
        </Button>
      </ManageToolbar>

      <Modal
        open={open}
        onClose={close}
        title={sectionTitle()}
        description={section === 'menu' ? t('manageDescription') : undefined}
        size="md"
      >
        {section === 'menu' ? (
          <ul className="m-0 grid list-none gap-2 p-0">
            <ManageMenuItem
              title={t('manageDetails')}
              hint={t('manageDetailsHint')}
              onClick={() => setSection('details')}
            />
            {props.canMutate && !archived ? (
              <ManageMenuItem
                title={t('manageEdit')}
                hint={t('manageEditHint')}
                onClick={() => setSection('edit')}
              />
            ) : null}
            {props.canMutate ? (
              <ManageMenuItem
                title={archived ? t('manageRestore') : t('manageArchive')}
                hint={
                  archived ? t('manageRestoreHint') : t('manageArchiveHint')
                }
                onClick={() => setSection('archive')}
              />
            ) : null}
            {props.canPurge ? (
              <ManageMenuItem
                title={t('manageDelete')}
                hint={t('manageDeleteHint')}
                onClick={() => setSection('delete')}
              />
            ) : null}
          </ul>
        ) : null}

        {section === 'details' ? (
          <div className="grid gap-4">
            <dl className="m-0 grid gap-3">
              <ManageDetailRow label={t('detailsId')} value={props.system.id} mono />
              <ManageDetailRow label={t('detailsSlug')} value={props.system.slug} mono />
              <ManageDetailRow label={tCommon('status')} value={props.system.status} />
              <ManageDetailRow
                label={t('type')}
                value={props.system.systemType || t('unspecified')}
              />
              <ManageDetailRow
                label={t('environment')}
                value={props.system.environment || tCommon('none')}
              />
              <ManageDetailRow
                label={t('version')}
                value={props.system.version || tCommon('none')}
              />
              <ManageDetailRow
                label={t('criticality')}
                value={
                  props.system.criticality
                    ? t(`criticalityOption.${props.system.criticality}` as
                        | 'criticalityOption.low'
                        | 'criticalityOption.medium'
                        | 'criticalityOption.high'
                        | 'criticalityOption.critical')
                    : t('criticalityUnset')
                }
              />
              <ManageDetailRow
                label={t('primaryUrl')}
                value={props.system.itDetails?.primaryUrl || tCommon('none')}
              />
              <ManageDetailRow
                label={t('hostname')}
                value={props.system.itDetails?.hostname || tCommon('none')}
              />
              <ManageDetailRow
                label={t('vendor')}
                value={props.system.itDetails?.vendor || tCommon('none')}
              />
              {props.system.systemType !== AI_ASSISTANT_TYPE ? (
                <>
                  <ManageDetailRow
                    label={t('itCostModeLabel')}
                    value={
                      props.system.itCostMode
                        ? t(`itCostMode.${props.system.itCostMode}`)
                        : t('itCostModeUnset')
                    }
                  />
                  <ManageDetailRow
                    label={t('itFlatMonthlyFee')}
                    value={props.system.itFlatMonthlyFee || tCommon('none')}
                  />
                  <ManageDetailRow
                    label={t('itOneTimeCost')}
                    value={props.system.itOneTimeCost || tCommon('none')}
                  />
                  <ManageDetailRow
                    label={t('itBudgetAllocation')}
                    value={props.system.itBudgetAllocation || tCommon('none')}
                  />
                </>
              ) : null}
              <ManageDetailRow
                label={tCommon('tags')}
                value={
                  props.system.tags.length > 0
                    ? props.system.tags.map((tag) => tag.name).join(', ')
                    : tCommon('none')
                }
              />
              <ManageDetailRow
                label={t('detailsCreated')}
                value={new Date(props.system.createdAt).toLocaleString()}
              />
              <ManageDetailRow
                label={tCommon('updated')}
                value={new Date(props.system.updatedAt).toLocaleString()}
              />
            </dl>
            <Button type="button" variant="secondary" onClick={() => setSection('menu')}>
              {tCommon('back')}
            </Button>
          </div>
        ) : null}

        {section === 'edit' ? (
          <div className="grid gap-4">
            <Field label={tCommon('name')}>
              <Input value={name} onChange={(e) => setName(e.target.value)} required />
            </Field>
            <Field label={t('projectOptional')}>
              <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                <option value="">{t('independentNoProject')}</option>
                {props.projects.map((project) => (
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
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
              />
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
              <Input
                value={environment}
                onChange={(e) => setEnvironment(e.target.value)}
              />
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
                  {DEPLOYMENT_MODELS.map((value) => (
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
            {showItCost ? (
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
                    {IT_COST_MODES.map((mode) => (
                      <option key={mode} value={mode}>
                        {t(`itCostMode.${mode}`)}
                      </option>
                    ))}
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
            <div className="flex flex-wrap gap-2">
              <Button type="button" disabled={pending} onClick={() => void saveEdit()}>
                {pending ? tCommon('saving') : tCommon('save')}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={pending}
                onClick={() => {
                  setError(null);
                  setSection('menu');
                }}
              >
                {tCommon('back')}
              </Button>
            </div>
          </div>
        ) : null}

        {section === 'archive' ? (
          <div className="grid gap-4">
            <p className="m-0 text-sm text-ink-muted">
              {archived ? t('manageRestoreHint') : t('manageArchiveHint')}
            </p>
            <ArchiveEntityButton
              kind="system"
              entityId={props.system.id}
              entityName={props.system.name}
              archived={archived}
              redirectOnArchive={redirectParent}
            />
            <Button type="button" variant="secondary" onClick={() => setSection('menu')}>
              {tCommon('back')}
            </Button>
          </div>
        ) : null}

        {section === 'delete' ? (
          <div className="grid gap-4">
            <p className="m-0 text-sm text-ink-muted">{t('manageDeleteHint')}</p>
            <PurgeEntityButton
              kind="system"
              entityId={props.system.id}
              entityName={props.system.name}
              redirectOnPurge={redirectParent}
            />
            <Button type="button" variant="secondary" onClick={() => setSection('menu')}>
              {tCommon('back')}
            </Button>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
