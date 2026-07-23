'use client';

import type { FormEvent } from 'react';
import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  LIFECYCLE_STATUSES,
  RECORD_TYPE_CATALOG,
  SOURCE_OF_TRUTH_MODES,
} from '@project-knowledge-hub/domain';
import { renderMarkdown } from '@project-knowledge-hub/markdown';
import { MarkdownDocument } from './MarkdownDocument';
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
} from './ui';

type Option = { id: string; name: string; slug: string };

type MediaItem = {
  id: string;
  url: string;
  markdownSnippet: string;
  altText: string | null;
  originalFilename: string | null;
  knowledgeRecordId: string | null;
  createdAt: string;
};

export type KnowledgeRecordEditorInitial = {
  id: string;
  title: string;
  summary: string | null;
  recordType: string;
  lifecycleStatus: string;
  sourceOfTruthMode: string;
  contentMarkdown: string;
  projectId: string | null;
  systemId: string | null;
  tags: Array<{ name: string }>;
  source: {
    sourceType: string;
    sourceProvider: string | null;
    sourceReference: string | null;
    sourceTitle: string | null;
    sourceUri: string | null;
    generatedByModel: string | null;
  } | null;
};

export type KnowledgeRecordEditorProps = {
  mode: 'create' | 'edit';
  workspaceSlug: string;
  workspaceId: string;
  projects: Option[];
  systems: Option[];
  initial?: KnowledgeRecordEditorInitial;
  /** `page` = full route shell; `modal` = content only for Modal xl. */
  layout?: 'page' | 'modal';
  onCancel?: () => void;
  onSaved?: (slug: string) => void;
};

export function KnowledgeRecordEditor(props: KnowledgeRecordEditorProps) {
  const router = useRouter();
  const t = useTranslations('records');
  const tCommon = useTranslations('common');
  const layout = props.layout ?? 'page';
  const [title, setTitle] = useState(props.initial?.title ?? '');
  const [summary, setSummary] = useState(props.initial?.summary ?? '');
  const [recordType, setRecordType] = useState(props.initial?.recordType ?? 'deployment-guide');
  const [lifecycleStatus, setLifecycleStatus] = useState(
    props.initial?.lifecycleStatus ?? 'draft',
  );
  const [sourceOfTruthMode, setSourceOfTruthMode] = useState(
    props.initial?.sourceOfTruthMode ?? 'hub_managed',
  );
  const [contentMarkdown, setContentMarkdown] = useState(
    props.initial?.contentMarkdown ??
      '# Deployment guide\n\n## Overview\n\nDescribe the deployment steps here.\n\n```bash\npnpm deploy\n```\n',
  );
  const [projectId, setProjectId] = useState(props.initial?.projectId ?? '');
  const [systemId, setSystemId] = useState(props.initial?.systemId ?? '');
  const [tags, setTags] = useState(
    props.initial?.tags.map((tag) => tag.name).join(', ') ?? '',
  );
  const [sourceProvider, setSourceProvider] = useState(
    props.initial?.source?.sourceProvider ?? '',
  );
  const [sourceReference, setSourceReference] = useState(
    props.initial?.source?.sourceReference ?? '',
  );
  const [sourceTitle, setSourceTitle] = useState(props.initial?.source?.sourceTitle ?? '');
  const [sourceUri, setSourceUri] = useState(props.initial?.source?.sourceUri ?? '');
  const [generatedByModel, setGeneratedByModel] = useState(
    props.initial?.source?.generatedByModel ?? '',
  );
  const [changeMessage, setChangeMessage] = useState('');
  const [previewHtml, setPreviewHtml] = useState('');
  const [previewToc, setPreviewToc] = useState<Array<{ id: string; text: string; depth: number }>>(
    [],
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);
  const [mediaBusy, setMediaBusy] = useState(false);
  const markdownRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [, startTransition] = useTransition();

  async function refreshMedia() {
    try {
      const qs = new URLSearchParams({ limit: '20' });
      const response = await fetch(
        `/api/v1/workspaces/${props.workspaceId}/media?${qs.toString()}`,
        { credentials: 'include', cache: 'no-store' },
      );
      if (!response.ok) return;
      const body = (await response.json()) as { media?: MediaItem[] };
      setMediaItems(body.media ?? []);
    } catch {
      // Non-blocking for editor
    }
  }

  useEffect(() => {
    void refreshMedia();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load on workspace change
  }, [props.workspaceId]);

  function insertMarkdownSnippet(snippet: string) {
    const el = markdownRef.current;
    if (!el) {
      setContentMarkdown((prev) => `${prev.trimEnd()}\n\n${snippet}\n`);
      return;
    }
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const next =
      contentMarkdown.slice(0, start) + snippet + contentMarkdown.slice(end);
    setContentMarkdown(next);
    requestAnimationFrame(() => {
      const pos = start + snippet.length;
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  }

  async function uploadMediaFile(file: File) {
    setMediaBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      if (props.initial?.id) {
        form.append('knowledgeRecordId', props.initial.id);
      }
      form.append('alt', file.name.replace(/\.[^.]+$/, '') || 'image');
      const response = await fetch(`/api/v1/workspaces/${props.workspaceId}/media`, {
        method: 'POST',
        credentials: 'include',
        body: form,
      });
      const body = (await response.json().catch(() => ({}))) as {
        media?: MediaItem;
        error?: { message?: string };
      };
      if (!response.ok || !body.media) {
        throw new Error(body.error?.message ?? t('mediaUploadFailed'));
      }
      insertMarkdownSnippet(body.media.markdownSnippet);
      await refreshMedia();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('mediaUploadFailed'));
    } finally {
      setMediaBusy(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }

  async function deleteMedia(mediaId: string) {
    setMediaBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/media/${mediaId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(body.error?.message ?? t('mediaDeleteFailed'));
      }
      await refreshMedia();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('mediaDeleteFailed'));
    } finally {
      setMediaBusy(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    startTransition(() => {
      void renderMarkdown(contentMarkdown).then((result) => {
        if (!cancelled) {
          setPreviewHtml(result.html);
          setPreviewToc(result.toc);
        }
      });
    });
    return () => {
      cancelled = true;
    };
  }, [contentMarkdown]);

  async function save(nextStatus?: string) {
    if (props.initial?.sourceOfTruthMode === 'git_managed') {
      setError(t('gitManagedReadOnly'));
      return;
    }
    setPending(true);
    setError(null);
    const status = nextStatus ?? lifecycleStatus;

    const body = {
      workspaceId: props.workspaceId,
      title,
      summary: summary || undefined,
      recordType,
      lifecycleStatus: status,
      sourceOfTruthMode,
      contentMarkdown,
      projectId: projectId || null,
      systemId: systemId || null,
      tags: tags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
      source: {
        sourceType: 'manual' as const,
        sourceProvider: sourceProvider || null,
        sourceReference: sourceReference || null,
        sourceTitle: sourceTitle || null,
        sourceUri: sourceUri || null,
        generatedByModel: generatedByModel || null,
      },
    };

    try {
      const response = await fetch(
        props.mode === 'create'
          ? '/api/v1/knowledge-records'
          : `/api/v1/knowledge-records/${props.initial?.id}`,
        {
          method: props.mode === 'create' ? 'POST' : 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            props.mode === 'create'
              ? body
              : {
                  title: body.title,
                  summary: body.summary ?? null,
                  recordType: body.recordType,
                  lifecycleStatus: body.lifecycleStatus,
                  sourceOfTruthMode: body.sourceOfTruthMode,
                  contentMarkdown: body.contentMarkdown,
                  projectId: body.projectId,
                  systemId: body.systemId,
                  tags: body.tags,
                  source: body.source,
                  changeMessage: changeMessage || undefined,
                },
          ),
        },
      );
      const payload = (await response.json()) as {
        knowledgeRecord?: { slug: string };
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? t('failedSave'));
      }
      const slug = payload.knowledgeRecord?.slug ?? '';
      if (props.onSaved) {
        props.onSaved(slug);
        router.refresh();
      } else {
        router.push(`/workspaces/${props.workspaceSlug}/records/${slug}`);
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('failedSave'));
    } finally {
      setPending(false);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void save();
  }

  function handleCancel() {
    if (props.onCancel) {
      props.onCancel();
      return;
    }
    router.push(`/workspaces/${props.workspaceSlug}`);
  }

  const gitManaged = props.initial?.sourceOfTruthMode === 'git_managed';
  const showCancel = Boolean(props.onCancel) || layout === 'page';
  const previewMinClass = layout === 'modal' ? 'min-h-[min(50vh,28rem)]' : 'min-h-[420px]';
  const textareaRows = layout === 'modal' ? 18 : 22;

  const form = (
    <form onSubmit={onSubmit} className="grid gap-4">
      {gitManaged ? (
        <Panel>
          <p className="m-0 text-sm text-ink-muted">{t('gitManagedReadOnly')}</p>
        </Panel>
      ) : null}

      <Panel className="grid gap-4 sm:grid-cols-2">
        <Field label={tCommon('title')}>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            data-modal-initial-focus={layout === 'modal' ? true : undefined}
          />
        </Field>
        <Field label={t('recordType')}>
          <Select
            value={recordType}
            onChange={(e) => setRecordType(e.target.value)}
          >
            {RECORD_TYPE_CATALOG.map((entry) => (
              <option key={entry.value} value={entry.value} title={entry.description}>
                {t(`typeLabels.${entry.value}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('lifecycleStatus')}>
          <Select
            value={lifecycleStatus}
            onChange={(e) => setLifecycleStatus(e.target.value)}
          >
            {LIFECYCLE_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('sourceOfTruth')}>
          <Select
            value={sourceOfTruthMode}
            onChange={(e) => setSourceOfTruthMode(e.target.value)}
          >
            {SOURCE_OF_TRUTH_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {mode}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('projectOptional')}>
          <Select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
          >
            <option value="">{tCommon('none')}</option>
            {props.projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('systemOptional')}>
          <Select
            value={systemId}
            onChange={(e) => setSystemId(e.target.value)}
          >
            <option value="">{tCommon('none')}</option>
            {props.systems.map((system) => (
              <option key={system.id} value={system.id}>
                {system.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={tCommon('summary')} className="sm:col-span-2">
          <Input
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
          />
        </Field>
        <Field label={tCommon('tagsHint')} className="sm:col-span-2">
          <Input value={tags} onChange={(e) => setTags(e.target.value)} />
        </Field>
      </Panel>

      <Panel>
        <h2 className="mt-0 mb-3 text-base font-semibold">{t('provenance')}</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('sourceTitle')}>
            <Input
              value={sourceTitle}
              onChange={(e) => setSourceTitle(e.target.value)}
            />
          </Field>
          <Field label={t('sourceProvider')}>
            <Input
              value={sourceProvider}
              onChange={(e) => setSourceProvider(e.target.value)}
            />
          </Field>
          <Field label={t('sourceReference')}>
            <Input
              value={sourceReference}
              onChange={(e) => setSourceReference(e.target.value)}
            />
          </Field>
          <Field label={t('sourceUri')}>
            <Input
              value={sourceUri}
              onChange={(e) => setSourceUri(e.target.value)}
            />
          </Field>
          <Field label={t('generatedByModel')} className="sm:col-span-2">
            <Input
              value={generatedByModel}
              onChange={(e) => setGeneratedByModel(e.target.value)}
            />
          </Field>
        </div>
      </Panel>

      {props.mode === 'edit' ? (
        <Panel>
          <Field label={t('changeMessage')}>
            <Input
              value={changeMessage}
              onChange={(e) => setChangeMessage(e.target.value)}
              placeholder={t('changeMessagePlaceholder')}
            />
          </Field>
        </Panel>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="grid gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="kh-label m-0">
              <span>{t('markdown')}</span>
            </p>
            <div className="flex flex-wrap gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void uploadMediaFile(file);
                }}
              />
              <Button
                type="button"
                variant="secondary"
                disabled={pending || mediaBusy || gitManaged}
                onClick={() => fileInputRef.current?.click()}
              >
                {mediaBusy ? t('mediaUploading') : t('mediaInsert')}
              </Button>
            </div>
          </div>
          <Textarea
            ref={markdownRef}
            value={contentMarkdown}
            onChange={(e) => setContentMarkdown(e.target.value)}
            rows={textareaRows}
            className={`${previewMinClass} font-mono text-sm`}
          />
          {mediaItems.length > 0 ? (
            <Panel className="p-3">
              <p className="m-0 mb-2 text-xs font-semibold tracking-[0.08em] text-ink-muted uppercase">
                {t('mediaRecent')}
              </p>
              <ul className="m-0 grid list-none gap-2 p-0">
                {mediaItems.map((item) => (
                  <li
                    key={item.id}
                    className="flex flex-wrap items-center justify-between gap-2 text-sm"
                  >
                    <span className="min-w-0 truncate text-ink">
                      {item.originalFilename ?? item.altText ?? item.id}
                    </span>
                    <span className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={pending || mediaBusy || gitManaged}
                        onClick={() => insertMarkdownSnippet(item.markdownSnippet)}
                      >
                        {t('mediaInsertExisting')}
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={pending || mediaBusy || gitManaged}
                        onClick={() => void deleteMedia(item.id)}
                      >
                        {t('mediaDelete')}
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
        </div>
        <div>
          <p className="kh-label mb-2">
            <span>{t('safePreview')}</span>
          </p>
          <Panel className={`${previewMinClass} overflow-auto`}>
            <MarkdownDocument html={previewHtml} toc={previewToc} />
          </Panel>
        </div>
      </div>

      {error ? <ErrorText>{error}</ErrorText> : null}

      <div className="flex flex-wrap gap-2">
        {showCancel ? (
          <Button type="button" variant="secondary" disabled={pending} onClick={handleCancel}>
            {tCommon('cancel')}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="secondary"
          disabled={pending || gitManaged}
          onClick={() => void save('draft')}
        >
          {t('saveDraft')}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={pending || gitManaged}
          onClick={() => void save('review_required')}
        >
          {t('markForReview')}
        </Button>
        <Button
          type="button"
          variant="success"
          disabled={pending || gitManaged}
          onClick={() => void save('verified')}
        >
          {t('markVerified')}
        </Button>
        <Button
          type="button"
          variant="success"
          disabled={pending || gitManaged}
          onClick={() => void save('current')}
        >
          {t('markCurrent')}
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? tCommon('saving') : tCommon('save')}
        </Button>
      </div>
    </form>
  );

  if (layout === 'modal') {
    return form;
  }

  return (
    <Page viewport>
      <PageHeader title={props.mode === 'create' ? t('createTitle') : t('editTitle')} />
      <p className="mt-0 mb-6">
        <Link
          href={`/workspaces/${props.workspaceSlug}`}
          className="text-sm text-ink-muted no-underline hover:text-ink"
        >
          {t('backToWorkspace')}
        </Link>
      </p>
      {form}
    </Page>
  );
}
