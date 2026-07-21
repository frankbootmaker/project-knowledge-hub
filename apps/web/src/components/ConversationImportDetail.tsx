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
  ListCard,
  Panel,
  Select,
  Textarea,
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

type ConversationImport = {
  id: string;
  title: string;
  contentFormat: string;
  rawContent: string;
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
    props.conversationImport.rawContent,
  );
  const [excerptNote, setExcerptNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onCreateDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (props.conversationImport.archivedAt) return;
    setPending(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/v1/conversation-imports/${props.conversationImport.id}/records`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title,
            recordType,
            contentMarkdown,
            excerptNote: excerptNote || null,
          }),
        },
      );
      const payload = (await response.json()) as {
        knowledgeRecord?: { slug: string };
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? t('failedCreateDraft'));
      }
      router.push(
        `/workspaces/${props.workspaceSlug}/records/${payload.knowledgeRecord?.slug ?? ''}`,
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('failedCreateDraft'));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-8">
      <Panel>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Badge tone="brand">{props.conversationImport.contentFormat}</Badge>
          {props.conversationImport.archivedAt ? (
            <Badge>{t('archivedBadge')}</Badge>
          ) : null}
          {props.conversationImport.generatedByModel ? (
            <span className="text-sm text-ink-muted">
              {t('modelLabel', { model: props.conversationImport.generatedByModel })}
            </span>
          ) : null}
        </div>
        <p className="mt-0 mb-2 text-sm text-ink-muted">{t('rawContentHelp')}</p>
        <pre className="kh-panel-inset m-0 max-h-[28rem] overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-sm text-ink">
          {props.conversationImport.rawContent}
        </pre>
      </Panel>

      <section>
        <h2 className="mt-0 mb-3 text-lg font-semibold text-ink">{t('linkedDrafts')}</h2>
        <ul className="m-0 grid list-none gap-3 p-0">
          {props.conversationImport.linkedRecords.map((record) => (
            <ListCard key={record.knowledgeRecordId}>
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/workspaces/${props.workspaceSlug}/records/${record.slug}`}
                  className="font-semibold no-underline"
                >
                  {record.title}
                </Link>
                <Badge tone="brand">{record.recordType}</Badge>
                <Badge>{record.lifecycleStatus}</Badge>
              </div>
              {record.excerptNote ? (
                <p className="mt-2 mb-0 text-sm text-ink-muted">{record.excerptNote}</p>
              ) : null}
            </ListCard>
          ))}
          {props.conversationImport.linkedRecords.length === 0 ? (
            <li className="kh-muted list-none">{t('noLinkedDrafts')}</li>
          ) : null}
        </ul>
      </section>

      {props.canMutate && !props.conversationImport.archivedAt ? (
        <section>
          <h2 className="mt-0 mb-3 text-lg font-semibold text-ink">
            {t('createDraftTitle')}
          </h2>
          <Panel>
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
              {error ? <ErrorText>{error}</ErrorText> : null}
              <Button type="submit" disabled={pending}>
                {pending ? t('creatingDraft') : t('createDraftButton')}
              </Button>
            </form>
          </Panel>
        </section>
      ) : null}
    </div>
  );
}
