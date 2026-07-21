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

export type ProjectManageDetails = {
  id: string;
  name: string;
  slug: string;
  status: string;
  summary: string | null;
  description: string | null;
  tags: Array<{ name: string }>;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

type Section = 'menu' | 'details' | 'edit' | 'archive' | 'delete';

export function ProjectManageMenu(props: {
  workspaceSlug: string;
  project: ProjectManageDetails;
  canMutate: boolean;
  canPurge: boolean;
}) {
  const t = useTranslations('projects');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const { pushToast } = useToast();
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<Section>('menu');
  const [name, setName] = useState(props.project.name);
  const [summary, setSummary] = useState(props.project.summary ?? '');
  const [description, setDescription] = useState(props.project.description ?? '');
  const [status, setStatus] = useState(props.project.status);
  const [tags, setTags] = useState(
    props.project.tags.map((tag) => tag.name).join(', '),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const archived = Boolean(props.project.archivedAt);
  const redirectParent = `/workspaces/${props.workspaceSlug}`;

  useEffect(() => {
    setName(props.project.name);
    setSummary(props.project.summary ?? '');
    setDescription(props.project.description ?? '');
    setStatus(props.project.status);
    setTags(props.project.tags.map((tag) => tag.name).join(', '));
  }, [props.project]);

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
      const response = await fetch(`/api/v1/projects/${props.project.id}`, {
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
          tags: tags
            .split(',')
            .map((tag) => tag.trim())
            .filter(Boolean),
        }),
      });
      const payload = (await response.json()) as {
        project?: { slug: string };
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? t('failedUpdate'));
      }
      pushToast(t('updated'));
      const nextSlug = payload.project?.slug ?? props.project.slug;
      if (nextSlug !== props.project.slug) {
        router.push(`/workspaces/${props.workspaceSlug}/projects/${nextSlug}`);
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
              <ManageDetailRow label={t('detailsId')} value={props.project.id} mono />
              <ManageDetailRow label={t('detailsSlug')} value={props.project.slug} mono />
              <ManageDetailRow label={tCommon('status')} value={props.project.status} />
              <ManageDetailRow
                label={tCommon('tags')}
                value={
                  props.project.tags.length > 0
                    ? props.project.tags.map((tag) => tag.name).join(', ')
                    : tCommon('none')
                }
              />
              <ManageDetailRow
                label={t('detailsCreated')}
                value={new Date(props.project.createdAt).toLocaleString()}
              />
              <ManageDetailRow
                label={tCommon('updated')}
                value={new Date(props.project.updatedAt).toLocaleString()}
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
                <option value="idea">idea</option>
                <option value="planned">planned</option>
                <option value="active">active</option>
                <option value="maintenance">maintenance</option>
                <option value="paused">paused</option>
                <option value="completed">completed</option>
                <option value="archived">archived</option>
              </Select>
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
              kind="project"
              entityId={props.project.id}
              entityName={props.project.name}
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
              kind="project"
              entityId={props.project.id}
              entityName={props.project.name}
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
