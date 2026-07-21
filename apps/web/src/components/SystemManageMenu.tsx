'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArchiveEntityButton } from './ArchiveEntityButton';
import { PurgeEntityButton } from './PurgeEntityButton';
import {
  ManageDetailRow,
  ManageMenuItem,
} from './manage-menu-shared';
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

export type SystemManageDetails = {
  id: string;
  name: string;
  slug: string;
  status: string;
  summary: string | null;
  description: string | null;
  systemType: string | null;
  environment: string | null;
  projectId: string | null;
  tags: Array<{ name: string }>;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

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
  const [tags, setTags] = useState(
    props.system.tags.map((tag) => tag.name).join(', '),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const archived = Boolean(props.system.archivedAt);
  const redirectParent = `/workspaces/${props.workspaceSlug}`;

  useEffect(() => {
    setName(props.system.name);
    setSummary(props.system.summary ?? '');
    setDescription(props.system.description ?? '');
    setStatus(props.system.status);
    setProjectId(props.system.projectId ?? '');
    setSystemType(props.system.systemType ?? '');
    setEnvironment(props.system.environment ?? '');
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
    return null;
  }

  return (
    <>
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        {t('manage')}
      </Button>

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
