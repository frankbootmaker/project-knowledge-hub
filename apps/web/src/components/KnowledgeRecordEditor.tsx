'use client';

import type { FormEvent } from 'react';
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { renderMarkdown } from '@project-knowledge-hub/markdown';
import { MarkdownDocument } from './MarkdownDocument';

const RECORD_TYPES = [
  'overview',
  'architecture',
  'deployment-guide',
  'installation-guide',
  'configuration',
  'configuration-snapshot',
  'runbook',
  'troubleshooting',
  'incident-resolution',
  'migration-guide',
  'decision',
  'lessons-learned',
  'command-reference',
  'inventory',
  'status',
  'roadmap',
  'recovery-guide',
  'backup-guide',
  'security-note',
  'integration-guide',
  'conversation-summary',
  'research-note',
  'proposal',
  'other',
] as const;

const LIFECYCLE_STATUSES = [
  'draft',
  'review_required',
  'verified',
  'current',
  'superseded',
  'deprecated',
  'archived',
] as const;

const SOURCE_MODES = [
  'hub_managed',
  'git_managed',
  'imported_snapshot',
  'ai_generated_draft',
  'external_authoritative',
] as const;

type Option = { id: string; name: string; slug: string };

export type KnowledgeRecordEditorProps = {
  mode: 'create' | 'edit';
  workspaceSlug: string;
  workspaceId: string;
  projects: Option[];
  systems: Option[];
  initial?: {
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
};

export function KnowledgeRecordEditor(props: KnowledgeRecordEditorProps) {
  const router = useRouter();
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
  const [, startTransition] = useTransition();

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
        throw new Error(payload.error?.message ?? 'Failed to save knowledge record');
      }
      router.push(
        `/workspaces/${props.workspaceSlug}/records/${payload.knowledgeRecord?.slug ?? ''}`,
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save knowledge record');
    } finally {
      setPending(false);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void save();
  }

  return (
    <main style={{ maxWidth: 1100, margin: '0 auto' }}>
      <h1>{props.mode === 'create' ? 'Create knowledge record' : 'Edit knowledge record'}</h1>
      <form onSubmit={onSubmit} style={{ display: 'grid', gap: '1rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.85rem' }}>
          <label style={{ display: 'grid', gap: '0.35rem' }}>
            <span>Title</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              style={{ padding: '0.65rem' }}
            />
          </label>
          <label style={{ display: 'grid', gap: '0.35rem' }}>
            <span>Record type</span>
            <select
              value={recordType}
              onChange={(e) => setRecordType(e.target.value)}
              style={{ padding: '0.65rem' }}
            >
              {RECORD_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'grid', gap: '0.35rem' }}>
            <span>Lifecycle status</span>
            <select
              value={lifecycleStatus}
              onChange={(e) => setLifecycleStatus(e.target.value)}
              style={{ padding: '0.65rem' }}
            >
              {LIFECYCLE_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'grid', gap: '0.35rem' }}>
            <span>Source of truth</span>
            <select
              value={sourceOfTruthMode}
              onChange={(e) => setSourceOfTruthMode(e.target.value)}
              style={{ padding: '0.65rem' }}
            >
              {SOURCE_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {mode}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'grid', gap: '0.35rem' }}>
            <span>Project (optional)</span>
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              style={{ padding: '0.65rem' }}
            >
              <option value="">None</option>
              {props.projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'grid', gap: '0.35rem' }}>
            <span>System (optional)</span>
            <select
              value={systemId}
              onChange={(e) => setSystemId(e.target.value)}
              style={{ padding: '0.65rem' }}
            >
              <option value="">None</option>
              {props.systems.map((system) => (
                <option key={system.id} value={system.id}>
                  {system.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label style={{ display: 'grid', gap: '0.35rem' }}>
          <span>Summary</span>
          <input
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            style={{ padding: '0.65rem' }}
          />
        </label>
        <label style={{ display: 'grid', gap: '0.35rem' }}>
          <span>Tags (comma-separated)</span>
          <input value={tags} onChange={(e) => setTags(e.target.value)} style={{ padding: '0.65rem' }} />
        </label>

        <fieldset
          style={{
            border: '1px solid rgba(21,32,43,0.12)',
            padding: '0.85rem',
            display: 'grid',
            gap: '0.65rem',
          }}
        >
          <legend>Provenance</legend>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.65rem' }}>
            <label style={{ display: 'grid', gap: '0.35rem' }}>
              <span>Source title</span>
              <input
                value={sourceTitle}
                onChange={(e) => setSourceTitle(e.target.value)}
                style={{ padding: '0.65rem' }}
              />
            </label>
            <label style={{ display: 'grid', gap: '0.35rem' }}>
              <span>Source provider</span>
              <input
                value={sourceProvider}
                onChange={(e) => setSourceProvider(e.target.value)}
                style={{ padding: '0.65rem' }}
              />
            </label>
            <label style={{ display: 'grid', gap: '0.35rem' }}>
              <span>Source reference</span>
              <input
                value={sourceReference}
                onChange={(e) => setSourceReference(e.target.value)}
                style={{ padding: '0.65rem' }}
              />
            </label>
            <label style={{ display: 'grid', gap: '0.35rem' }}>
              <span>Source URI</span>
              <input
                value={sourceUri}
                onChange={(e) => setSourceUri(e.target.value)}
                style={{ padding: '0.65rem' }}
              />
            </label>
            <label style={{ display: 'grid', gap: '0.35rem', gridColumn: '1 / -1' }}>
              <span>Generated by model</span>
              <input
                value={generatedByModel}
                onChange={(e) => setGeneratedByModel(e.target.value)}
                style={{ padding: '0.65rem' }}
              />
            </label>
          </div>
        </fieldset>

        {props.mode === 'edit' ? (
          <label style={{ display: 'grid', gap: '0.35rem' }}>
            <span>Change message (for new versions)</span>
            <input
              value={changeMessage}
              onChange={(e) => setChangeMessage(e.target.value)}
              placeholder="What changed?"
              style={{ padding: '0.65rem' }}
            />
          </label>
        ) : null}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          <label style={{ display: 'grid', gap: '0.35rem' }}>
            <span>Markdown</span>
            <textarea
              value={contentMarkdown}
              onChange={(e) => setContentMarkdown(e.target.value)}
              rows={22}
              style={{
                padding: '0.75rem',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: '0.9rem',
              }}
            />
          </label>
          <div>
            <div style={{ marginBottom: '0.35rem' }}>Safe preview</div>
            <div
              style={{
                padding: '0.85rem',
                minHeight: 420,
                background: 'rgba(255,255,255,0.8)',
                border: '1px solid rgba(21,32,43,0.1)',
                overflow: 'auto',
              }}
            >
              <MarkdownDocument html={previewHtml} toc={previewToc} />
            </div>
          </div>
        </div>

        {error ? <p style={{ color: '#9b1c1c' }}>{error}</p> : null}

        <div style={{ display: 'flex', gap: '0.65rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            disabled={pending}
            onClick={() => void save('draft')}
            style={{ padding: '0.75rem 1rem', border: '1px solid #1f4b73', background: 'white' }}
          >
            Save draft
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => void save('review_required')}
            style={{ padding: '0.75rem 1rem', border: '1px solid #1f4b73', background: 'white' }}
          >
            Mark for review
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => void save('verified')}
            style={{
              padding: '0.75rem 1rem',
              border: 'none',
              background: '#1f6b4a',
              color: 'white',
            }}
          >
            Mark verified
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => void save('current')}
            style={{
              padding: '0.75rem 1rem',
              border: 'none',
              background: '#145a36',
              color: 'white',
            }}
          >
            Mark current
          </button>
          <button
            type="submit"
            disabled={pending}
            style={{ padding: '0.75rem 1rem', border: 'none', background: '#1f4b73', color: 'white' }}
          >
            {pending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </main>
  );
}
