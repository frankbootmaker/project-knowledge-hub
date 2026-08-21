'use client';

import type { FormEvent } from 'react';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { RECORD_TYPE_CATALOG } from '@project-knowledge-hub/domain';
import {
  Badge,
  Button,
  ErrorText,
  Field,
  Input,
  Select,
  Textarea,
  lifecycleLabel,
} from './ui';

type LinkedRecord = {
  knowledgeRecordId: string;
  title: string;
  slug: string;
  recordType: string;
  lifecycleStatus: string;
  excerptNote: string | null;
  createdAt: string;
};

type ContentWarning = {
  code: string;
  severity: 'info' | 'warning' | 'high';
  count: number;
  label: string;
};

type SuggestedChunk = {
  id: string;
  title: string;
  contentMarkdown: string;
  excerptNote: string;
};

type ConversationImport = {
  id: string;
  title: string;
  contentFormat: string;
  rawContent: string;
  draftMarkdownPreview?: string;
  contentWarnings?: ContentWarning[];
  suggestedChunks?: SuggestedChunk[];
  sourceProvider: string | null;
  generatedByModel: string | null;
  archivedAt: string | null;
  createdAt: string;
  linkedRecords: LinkedRecord[];
};

export function ConversationImportDetail(props: {
  workspaceSlug: string;
  conversationImport: ConversationImport;
  canMutate: boolean;
}) {
  const t = useTranslations('imports');
  const tRecords = useTranslations('records');
  const tCommon = useTranslations('common');
  const router = useRouter();

  const [title, setTitle] = useState(
    `${props.conversationImport.title} — summary`,
  );
  const [recordType, setRecordType] = useState('conversation-summary');
  const [contentMarkdown, setContentMarkdown] = useState(
    props.conversationImport.draftMarkdownPreview ??
      props.conversationImport.rawContent,
  );
  const [excerptNote, setExcerptNote] = useState('');
  const [acknowledgeSecrets, setAcknowledgeSecrets] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const warnings = props.conversationImport.contentWarnings ?? [];
  const suggestedChunks = props.conversationImport.suggestedChunks ?? [];
  const hasHigh = warnings.some((w) => w.severity === 'high');

  async function createDraft(input: {
    title: string;
    contentMarkdown: string;
    excerptNote: string | null;
    acknowledgeSecrets: boolean;
  }) {
    const response = await fetch(
      `/api/v1/conversation-imports/${props.conversationImport.id}/records`,
      {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: input.title,
          recordType,
          contentMarkdown: input.contentMarkdown,
          excerptNote: input.excerptNote,
          acknowledgeSecrets: input.acknowledgeSecrets || undefined,
        }),
      },
    );
    const payload = (await response.json()) as {
      knowledgeRecord?: { slug: string };
      error?: { message?: string; details?: { contentWarnings?: ContentWarning[] } };
    };
    if (!response.ok) {
      throw new Error(payload.error?.message ?? t('failedCreateDraft'));
    }
    return payload.knowledgeRecord?.slug ?? '';
  }

  async function onCreateDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (props.conversationImport.archivedAt) return;
    setPending(true);
    setError(null);

    try {
      const slug = await createDraft({
        title,
        contentMarkdown,
        excerptNote: excerptNote || null,
        acknowledgeSecrets,
      });
      router.push(`/workspaces/${props.workspaceSlug}/records/${slug}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('failedCreateDraft'));
    } finally {
      setPending(false);
    }
  }

  async function onCreateChunkDraft(chunk: SuggestedChunk) {
    if (props.conversationImport.archivedAt) return;
    setPending(true);
    setError(null);
    try {
      const slug = await createDraft({
        title: chunk.title,
        contentMarkdown: chunk.contentMarkdown,
        excerptNote: chunk.excerptNote,
        acknowledgeSecrets,
      });
      router.push(`/workspaces/${props.workspaceSlug}/records/${slug}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('failedCreateDraft'));
    } finally {
      setPending(false);
    }
  }

  function applyChunk(chunk: SuggestedChunk) {
    setTitle(chunk.title);
    setContentMarkdown(chunk.contentMarkdown);
    setExcerptNote(chunk.excerptNote);
  }

  return (
    <div className="grid gap-8">
      {warnings.length > 0 ? (
        <div className="kh-ops-status-row" data-tone="danger">
          <div>
            <p className="font-medium text-ink">{t('secretWarningsTitle')}</p>
            <p>{t('secretWarningsHelp')}</p>
            <ul className="mt-2 mb-0 grid list-none gap-2 p-0">
              {warnings.map((warning) => (
                <li key={warning.code} className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge tone={warning.severity === 'high' ? 'danger' : 'neutral'}>
                    {warning.severity}
                  </Badge>
                  <span>
                    {warning.label} × {warning.count}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      <section className="kh-ops-panel">
        <div className="kh-ops-panel-head">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="brand">{props.conversationImport.contentFormat}</Badge>
            {props.conversationImport.archivedAt ? (
              <Badge>{t('archivedBadge')}</Badge>
            ) : null}
            {props.conversationImport.generatedByModel ? (
              <span className="kh-ops-panel-meta">
                {t('modelLabel', { model: props.conversationImport.generatedByModel })}
              </span>
            ) : null}
          </div>
        </div>
        <div className="kh-ops-card-body">
          <p className="mt-0 mb-2 text-sm text-ink-muted">{t('rawContentHelp')}</p>
          <pre className="kh-ops-code m-0 max-h-[28rem] overflow-auto whitespace-pre-wrap break-words">
            {props.conversationImport.rawContent}
          </pre>
        </div>
      </section>

      <section className="kh-ops-panel">
        <div className="kh-ops-panel-head">
          <h2 className="kh-ops-panel-title">{t('linkedDrafts')}</h2>
        </div>
        {props.conversationImport.linkedRecords.length === 0 ? (
          <p className="kh-ops-empty">{t('noLinkedDrafts')}</p>
        ) : (
          <div className="kh-ops-table-wrap">
            <table className="kh-ops-data-table">
              <thead>
                <tr>
                  <th>{tCommon('title')}</th>
                  <th>{tRecords('recordType')}</th>
                  <th>{tCommon('status')}</th>
                </tr>
              </thead>
              <tbody>
                {props.conversationImport.linkedRecords.map((record) => (
                  <tr key={record.knowledgeRecordId}>
                    <td className="kh-ops-primary-cell">
                      <Link
                        href={`/workspaces/${props.workspaceSlug}/records/${record.slug}`}
                        className="no-underline"
                      >
                        {record.title}
                      </Link>
                    </td>
                    <td>
                      <span className="kh-ops-type-chip">{record.recordType}</span>
                    </td>
                    <td>
                      {lifecycleLabel(record.lifecycleStatus, tRecords)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {props.canMutate &&
      !props.conversationImport.archivedAt &&
      suggestedChunks.length > 0 ? (
        <section>
          <h2 className="mt-0 mb-2 text-lg font-semibold text-ink">
            {t('autoSplitTitle')}
          </h2>
          <p className="mt-0 mb-3 text-sm text-ink-muted">{t('autoSplitHelp')}</p>
          <div className="kh-ops-table-wrap">
            <table className="kh-ops-data-table">
              <thead>
                <tr>
                  <th>{tCommon('title')}</th>
                  <th>{t('draftContent')}</th>
                  <th>{t('colActions')}</th>
                </tr>
              </thead>
              <tbody>
                {suggestedChunks.map((chunk) => (
                  <tr key={chunk.id}>
                    <td className="kh-ops-primary-cell">{chunk.title}</td>
                    <td className="max-w-xl whitespace-normal">
                      <p className="m-0 line-clamp-3 whitespace-pre-wrap text-ink-muted">
                        {chunk.contentMarkdown}
                      </p>
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={pending}
                          onClick={() => applyChunk(chunk)}
                        >
                          {t('autoSplitUse')}
                        </Button>
                        <Button
                          type="button"
                          disabled={pending || (hasHigh && !acknowledgeSecrets)}
                          onClick={() => void onCreateChunkDraft(chunk)}
                        >
                          {t('autoSplitCreate')}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {props.canMutate && !props.conversationImport.archivedAt ? (
        <section className="kh-ops-panel">
          <div className="kh-ops-panel-head">
            <h2 className="kh-ops-panel-title">{t('createDraftTitle')}</h2>
          </div>
          <div className="kh-ops-card-body">
            <p className="mt-0 mb-4 text-sm text-ink-muted">{t('createDraftHelp')}</p>
            <form onSubmit={onCreateDraft} className="grid gap-4">
              <Field label={tCommon('name')}>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                />
              </Field>
              <Field label={tRecords('recordType')}>
                <Select
                  value={recordType}
                  onChange={(e) => setRecordType(e.target.value)}
                >
                  {RECORD_TYPE_CATALOG.map((entry) => (
                    <option key={entry.value} value={entry.value}>
                      {tRecords(`typeLabels.${entry.value}` as 'typeLabels.overview')}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('draftContent')}>
                <Textarea
                  value={contentMarkdown}
                  onChange={(e) => setContentMarkdown(e.target.value)}
                  rows={14}
                  required
                  className="font-mono text-sm"
                />
              </Field>
              <Field label={t('excerptNote')}>
                <Input
                  value={excerptNote}
                  onChange={(e) => setExcerptNote(e.target.value)}
                  placeholder={t('excerptNotePlaceholder')}
                />
              </Field>
              {hasHigh ? (
                <label className="flex items-start gap-2 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={acknowledgeSecrets}
                    onChange={(e) => setAcknowledgeSecrets(e.target.checked)}
                    className="mt-1"
                  />
                  <span>{t('acknowledgeSecrets')}</span>
                </label>
              ) : null}
              {error ? <ErrorText>{error}</ErrorText> : null}
              <Button type="submit" disabled={pending || (hasHigh && !acknowledgeSecrets)}>
                {pending ? t('creatingDraft') : t('createDraftButton')}
              </Button>
            </form>
          </div>
        </section>
      ) : null}
    </div>
  );
}
