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
import { localeLabels, locales, type AppLocale } from '../i18n/config';
import { KnowledgeRecordDeliveryLinksField } from './KnowledgeRecordDeliveryLinksField';
import { MarkdownDocument } from './MarkdownDocument';
import {
  Button,
  ErrorText,
  Field,
  Input,
  Page,
  PageHeader,
  Select,
  Textarea,
} from './ui';

type MarkdownFormat = 'h1' | 'h2' | 'bold' | 'link' | 'list' | 'code';

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
  language?: string | null;
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
  const initialLanguage = (props.initial?.language ?? 'en') as string;
  const [language, setLanguage] = useState(
    locales.includes(initialLanguage as AppLocale) ? initialLanguage : 'en',
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

  function applyMarkdownFormat(kind: MarkdownFormat) {
    const el = markdownRef.current;
    const start = el?.selectionStart ?? contentMarkdown.length;
    const end = el?.selectionEnd ?? contentMarkdown.length;
    const selected = contentMarkdown.slice(start, end);
    let snippet = '';
    switch (kind) {
      case 'h1':
        snippet = selected ? `# ${selected}` : '# Heading';
        break;
      case 'h2':
        snippet = selected ? `## ${selected}` : '## Heading';
        break;
      case 'bold':
        snippet = `**${selected || 'bold'}**`;
        break;
      case 'link':
        snippet = `[${selected || 'text'}](url)`;
        break;
      case 'list':
        snippet = selected
          ? selected
              .split('\n')
              .map((line) => (line.trim() ? `- ${line}` : line))
              .join('\n')
          : '- item';
        break;
      case 'code': {
        const useFence = !selected || selected.includes('\n');
        snippet = useFence
          ? `\`\`\`\n${selected || 'code'}\n\`\`\``
          : `\`${selected}\``;
        break;
      }
    }
    const next = contentMarkdown.slice(0, start) + snippet + contentMarkdown.slice(end);
    setContentMarkdown(next);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const pos = start + snippet.length;
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
      language,
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
                  language: body.language,
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
  const isEdit = props.mode === 'edit';
  const showManageStrip = isEdit && layout === 'page' && !gitManaged;
  const showActionLine = !showManageStrip;
  const editorLocked = pending || gitManaged;
  const tagNames = tags
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
  const textareaRows = layout === 'modal' ? 18 : 22;
  const markdownEditorClass = layout === 'modal'
    ? 'kh-ops-markdown-editor kh-ops-markdown-editor-compact'
    : 'kh-ops-markdown-editor';

  const titleField = (
    <Field label={tCommon('title')}>
      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        required
        disabled={gitManaged}
        data-modal-initial-focus={layout === 'modal' ? true : undefined}
      />
    </Field>
  );

  const summaryField = (
    <Field label={tCommon('summary')} className={isEdit ? undefined : 'kh-ops-field-span'}>
      <Input
        value={summary}
        onChange={(e) => setSummary(e.target.value)}
        disabled={gitManaged}
      />
    </Field>
  );

  const stateFields = (
    <>
      <Field label={t('recordType')}>
        <Select
          value={recordType}
          onChange={(e) => setRecordType(e.target.value)}
          disabled={gitManaged}
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
          disabled={gitManaged}
        >
          {LIFECYCLE_STATUSES.map((status) => (
            <option key={status} value={status}>
              {t(`lifecycleLabels.${status}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t('sourceOfTruth')}>
        <Select
          value={sourceOfTruthMode}
          onChange={(e) => setSourceOfTruthMode(e.target.value)}
          disabled={gitManaged}
        >
          {SOURCE_OF_TRUTH_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {mode}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t('contentLanguage')}>
        <Select
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          disabled={gitManaged}
        >
          {locales.map((code) => (
            <option key={code} value={code}>
              {localeLabels[code]} ({code})
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t('projectOptional')}>
        <Select
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          disabled={gitManaged}
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
          disabled={gitManaged}
        >
          <option value="">{tCommon('none')}</option>
          {props.systems.map((system) => (
            <option key={system.id} value={system.id}>
              {system.name}
            </option>
          ))}
        </Select>
      </Field>
    </>
  );

  const tagsField = (
    <Field label={tCommon('tagsHint')} className="kh-ops-field-span">
      <Input value={tags} onChange={(e) => setTags(e.target.value)} disabled={gitManaged} />
    </Field>
  );

  const saveActions = (
    <>
      {showCancel ? (
        <Button type="button" variant="secondary" disabled={pending} onClick={handleCancel}>
          {tCommon('cancel')}
        </Button>
      ) : null}
      <Button
        type="button"
        variant="secondary"
        disabled={editorLocked}
        onClick={() => void save('draft')}
      >
        {t('saveDraft')}
      </Button>
      <Button
        type="button"
        variant="secondary"
        disabled={editorLocked}
        onClick={() => void save('review_required')}
      >
        {t('markForReview')}
      </Button>
      <Button
        type="button"
        variant="success"
        disabled={editorLocked}
        onClick={() => void save('verified')}
      >
        {t('markVerified')}
      </Button>
      <Button
        type="button"
        variant="success"
        disabled={editorLocked}
        onClick={() => void save('current')}
      >
        {t('markCurrent')}
      </Button>
      <Button type="submit" disabled={editorLocked}>
        {pending ? tCommon('saving') : tCommon('save')}
      </Button>
    </>
  );

  const form = (
    <form onSubmit={onSubmit} className="grid gap-3">
      {gitManaged ? (
        <div className="kh-ops-status-row">
          <p>{t('gitManagedReadOnly')}</p>
        </div>
      ) : null}

      {showManageStrip ? (
        <div className="kh-ops-manage-strip is-standalone">{saveActions}</div>
      ) : null}

      <div className="kh-ops-editor-shell">
        <section className="kh-ops-panel">
          <div className="kh-ops-card-body">
            <div className="kh-ops-form-grid">
              {titleField}
              {summaryField}
              {isEdit ? null : (
                <>
                  {stateFields}
                  {tagsField}
                </>
              )}
            </div>
          </div>
          <div className="kh-ops-editor-toolbar">
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
            <button
              type="button"
              disabled={editorLocked}
              onClick={() => applyMarkdownFormat('h1')}
            >
              H1
            </button>
            <button
              type="button"
              disabled={editorLocked}
              onClick={() => applyMarkdownFormat('h2')}
            >
              H2
            </button>
            <button
              type="button"
              disabled={editorLocked}
              onClick={() => applyMarkdownFormat('bold')}
            >
              Bold
            </button>
            <button
              type="button"
              disabled={editorLocked}
              onClick={() => applyMarkdownFormat('link')}
            >
              Link
            </button>
            <button
              type="button"
              disabled={editorLocked}
              onClick={() => applyMarkdownFormat('list')}
            >
              List
            </button>
            <button
              type="button"
              disabled={editorLocked}
              onClick={() => applyMarkdownFormat('code')}
            >
              Code
            </button>
            <button
              type="button"
              disabled={pending || mediaBusy || gitManaged}
              onClick={() => fileInputRef.current?.click()}
            >
              {mediaBusy ? t('mediaUploading') : t('mediaInsert')}
            </button>
          </div>
          <Textarea
            ref={markdownRef}
            value={contentMarkdown}
            onChange={(e) => setContentMarkdown(e.target.value)}
            rows={textareaRows}
            disabled={gitManaged}
            aria-label={t('markdown')}
            className={markdownEditorClass}
          />
          {mediaItems.length > 0 ? (
            <div className="kh-ops-media-recent">
              <p className="kh-ops-panel-meta m-0 mb-2">{t('mediaRecent')}</p>
              <ul className="m-0 grid list-none gap-0 p-0">
                {mediaItems.map((item) => (
                  <li key={item.id} className="kh-ops-linked-row">
                    <span className="min-w-0 truncate">
                      {item.originalFilename ?? item.altText ?? item.id}
                    </span>
                    <span className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="kh-ops-text-btn"
                        disabled={pending || mediaBusy || gitManaged}
                        onClick={() => insertMarkdownSnippet(item.markdownSnippet)}
                      >
                        {t('mediaInsertExisting')}
                      </button>
                      <button
                        type="button"
                        className="kh-ops-text-btn"
                        disabled={pending || mediaBusy || gitManaged}
                        onClick={() => void deleteMedia(item.id)}
                      >
                        {t('mediaDelete')}
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>

        <aside className="kh-ops-editor-stack">
          {isEdit ? (
            <section className="kh-ops-panel">
              <div className="kh-ops-panel-head">
                <h2 className="kh-ops-panel-title">{tCommon('status')}</h2>
              </div>
              <div className="kh-ops-card-body">
                <div className="kh-ops-form-grid">{stateFields}</div>
              </div>
            </section>
          ) : null}
          {isEdit ? (
            <section className="kh-ops-panel">
              <div className="kh-ops-panel-head">
                <h2 className="kh-ops-panel-title">{tCommon('tags')}</h2>
              </div>
              {tagNames.length > 0 ? (
                <div className="kh-ops-tag-list">
                  {tagNames.map((tag) => (
                    <span key={tag} className="kh-ops-tag">
                      {tag}
                    </span>
                  ))}
                </div>
              ) : null}
              <div className="kh-ops-card-body">{tagsField}</div>
            </section>
          ) : null}
          <section className="kh-ops-panel">
            <div className="kh-ops-panel-head">
              <h2 className="kh-ops-panel-title">{t('safePreview')}</h2>
            </div>
            <div className="kh-ops-preview-pane">
              <MarkdownDocument html={previewHtml} toc={previewToc} />
            </div>
          </section>
        </aside>
      </div>

      <section className="kh-ops-panel">
        <div className="kh-ops-panel-head">
          <h2 className="kh-ops-panel-title">{t('provenance')}</h2>
        </div>
        <div className="kh-ops-card-body">
          <div className="kh-ops-form-grid">
            <Field label={t('sourceTitle')}>
              <Input
                value={sourceTitle}
                onChange={(e) => setSourceTitle(e.target.value)}
                disabled={gitManaged}
              />
            </Field>
            <Field label={t('sourceProvider')}>
              <Input
                value={sourceProvider}
                onChange={(e) => setSourceProvider(e.target.value)}
                disabled={gitManaged}
              />
            </Field>
            <Field label={t('sourceReference')}>
              <Input
                value={sourceReference}
                onChange={(e) => setSourceReference(e.target.value)}
                disabled={gitManaged}
              />
            </Field>
            <Field label={t('sourceUri')}>
              <Input
                value={sourceUri}
                onChange={(e) => setSourceUri(e.target.value)}
                disabled={gitManaged}
              />
            </Field>
            <Field label={t('generatedByModel')} className="kh-ops-field-span">
              <Input
                value={generatedByModel}
                onChange={(e) => setGeneratedByModel(e.target.value)}
                disabled={gitManaged}
              />
            </Field>
            {isEdit ? (
              <Field label={t('changeMessage')} className="kh-ops-field-span">
                <Input
                  value={changeMessage}
                  onChange={(e) => setChangeMessage(e.target.value)}
                  placeholder={t('changeMessagePlaceholder')}
                  disabled={gitManaged}
                />
              </Field>
            ) : null}
            {isEdit && props.initial?.id && projectId ? (
              <KnowledgeRecordDeliveryLinksField
                recordId={props.initial.id}
                projectId={projectId}
                canMutate={!gitManaged}
              />
            ) : null}
          </div>
        </div>
        {showActionLine ? (
          <div className="kh-ops-action-line">
            <span className="kh-ops-panel-meta">
              {isEdit ? t('editTitle') : t('createTitle')}
            </span>
            <span className="flex flex-wrap gap-2">{saveActions}</span>
          </div>
        ) : null}
      </section>

      {error ? <ErrorText>{error}</ErrorText> : null}
    </form>
  );

  if (layout === 'modal') {
    return form;
  }

  return (
    <Page viewport>
      <PageHeader
        eyebrow={t('eyebrow')}
        title={isEdit ? t('editTitle') : t('createTitle')}
        description={
          <Link
            href={`/workspaces/${props.workspaceSlug}`}
            className="text-ink-muted no-underline hover:text-ink"
          >
            {t('backToWorkspace')}
          </Link>
        }
      />
      {form}
    </Page>
  );
}
