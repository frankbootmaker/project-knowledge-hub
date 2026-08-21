'use client';

import type { FormEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
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
  Panel,
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

type MediaLink = {
  workspaceMediaId: string;
  attachmentIndex: number;
  originalFilename: string | null;
  url: string;
};

type DocumentImport = {
  id: string;
  title: string;
  lane: string;
  status: string;
  ocrEngine?: string;
  ocrLang?: string;
  originalFilename: string;
  contentType: string;
  byteSize: number;
  convertedMarkdown: string | null;
  contentWarnings?: ContentWarning[];
  conversionWarnings?: string[];
  conversionError: string | null;
  progressStage?: string | null;
  progressMessage?: string | null;
  progressLog?: string | null;
  archivedAt: string | null;
  createdAt: string;
  linkedRecords: LinkedRecord[];
  media: MediaLink[];
};

const PROGRESS_STAGES = [
  'queued',
  'reading',
  'converting',
  'ocr',
  'storing_media',
  'finalizing',
] as const;

type ProgressStage = (typeof PROGRESS_STAGES)[number];

function isProgressStage(value: string | null | undefined): value is ProgressStage {
  return (
    typeof value === 'string' &&
    (PROGRESS_STAGES as readonly string[]).includes(value)
  );
}

export function DocumentImportDetail(props: {
  workspaceSlug: string;
  documentImport: DocumentImport;
  canMutate: boolean;
}) {
  const t = useTranslations('documentImports');
  const tRecords = useTranslations('records');
  const tCommon = useTranslations('common');
  const router = useRouter();

  const [doc, setDoc] = useState(props.documentImport);
  const [title, setTitle] = useState(props.documentImport.title);
  const [recordType, setRecordType] = useState('note');
  const [contentMarkdown, setContentMarkdown] = useState(
    props.documentImport.convertedMarkdown ?? '',
  );
  const [excerptNote, setExcerptNote] = useState('');
  const [acknowledgeSecrets, setAcknowledgeSecrets] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailsAutoOpenedRef = useRef(false);
  const detailsLogRef = useRef<HTMLPreElement | null>(null);
  const inProgress = doc.status === 'pending' || doc.status === 'converting';

  useEffect(() => {
    if (!inProgress) return;
    const startedAt = Date.parse(doc.createdAt);
    const tick = () => {
      const base = Number.isFinite(startedAt) ? startedAt : Date.now();
      setElapsedSec(Math.max(0, Math.floor((Date.now() - base) / 1000)));
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [doc.createdAt, inProgress]);

  useEffect(() => {
    const log = doc.progressLog?.trim() ?? '';
    if (log && !detailsAutoOpenedRef.current) {
      detailsAutoOpenedRef.current = true;
      setDetailsOpen(true);
    }
  }, [doc.progressLog]);

  useEffect(() => {
    if (doc.status === 'ready' || doc.status === 'failed') return;
    const timer = setInterval(async () => {
      try {
        const response = await fetch(`/api/v1/document-imports/${doc.id}`, {
          credentials: 'include',
          cache: 'no-store',
        });
        if (!response.ok) return;
        const payload = (await response.json()) as {
          documentImport: DocumentImport;
        };
        setDoc(payload.documentImport);
        if (payload.documentImport.convertedMarkdown) {
          setContentMarkdown(payload.documentImport.convertedMarkdown);
        }
        if (payload.documentImport.title) {
          setTitle(payload.documentImport.title);
        }
        const log = payload.documentImport.progressLog?.trim() ?? '';
        if (log && !detailsAutoOpenedRef.current) {
          detailsAutoOpenedRef.current = true;
          setDetailsOpen(true);
        }
        if (
          payload.documentImport.status === 'ready' ||
          payload.documentImport.status === 'failed'
        ) {
          router.refresh();
        }
      } catch {
        // ignore poll errors
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [doc.id, doc.status, router]);

  useEffect(() => {
    const el = detailsLogRef.current;
    if (!el || !detailsOpen) return;
    el.scrollTop = el.scrollHeight;
  }, [doc.progressLog, detailsOpen]);

  const warnings = doc.contentWarnings ?? [];
  const hasHigh = warnings.some((w) => w.severity === 'high');
  const ready = doc.status === 'ready' && Boolean(doc.convertedMarkdown);
  const stageLabel = isProgressStage(doc.progressStage)
    ? t(`progressStage_${doc.progressStage}`)
    : t('convertingHint');

  async function onCreateDraft(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/document-imports/${doc.id}/records`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          recordType,
          contentMarkdown,
          excerptNote: excerptNote || undefined,
          acknowledgeSecrets,
        }),
      });
      const payload = (await response.json()) as {
        knowledgeRecord?: { id: string; slug: string };
        error?: { message?: string; details?: { contentWarnings?: ContentWarning[] } };
      };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? t('failedDraft'));
      }
      const slug = payload.knowledgeRecord?.slug;
      if (slug) {
        router.push(`/workspaces/${props.workspaceSlug}/records/${slug}`);
      } else {
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('failedDraft'));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-6">
      <Panel>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="m-0 text-lg font-medium">{doc.title}</h2>
          <Badge
            tone={
              doc.status === 'ready'
                ? 'success'
                : doc.status === 'failed'
                  ? 'danger'
                  : 'warn'
            }
          >
            {t(`status_${doc.status}`)}
          </Badge>
          <Badge tone="neutral">{doc.lane}</Badge>
          {doc.ocrEngine === 'none' ||
          doc.ocrEngine === 'vision' ||
          doc.ocrEngine === 'tesseract' ? (
            <Badge tone="neutral">{t(`ocrEngine_${doc.ocrEngine}`)}</Badge>
          ) : null}
          {doc.ocrLang === 'eng' ||
          doc.ocrLang === 'deu' ||
          doc.ocrLang === 'hun' ? (
            <Badge tone="neutral">{t(`ocrLang_${doc.ocrLang}`)}</Badge>
          ) : null}
        </div>
        <p className="mt-2 mb-0 text-sm text-ink-muted">
          {doc.originalFilename} · {Math.round(doc.byteSize / 1024)} KB ·{' '}
          {doc.contentType}
        </p>
        {doc.conversionError ? (
          <ErrorText>{doc.conversionError}</ErrorText>
        ) : null}
        {(doc.conversionWarnings?.length ?? 0) > 0 ? (
          <ul className="mt-3 text-sm text-ink-muted">
            {doc.conversionWarnings!.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        ) : null}
        {inProgress ? (
          <div className="mt-4 grid gap-3">
            <div className="kh-ops-stage-strip">
              {PROGRESS_STAGES.map((stage, index) => {
                const currentIndex = isProgressStage(doc.progressStage)
                  ? PROGRESS_STAGES.indexOf(doc.progressStage)
                  : 0;
                const state =
                  index < currentIndex
                    ? 'done'
                    : index === currentIndex
                      ? 'active'
                      : '';
                return (
                  <article
                    key={stage}
                    className={`kh-ops-stage-card ${state}`.trim()}
                  >
                    <small>
                      {String(index + 1).padStart(2, '0')} / {t(`progressStage_${stage}`)}
                    </small>
                    <strong>
                      {index === currentIndex
                        ? doc.progressMessage || stageLabel
                        : index < currentIndex
                          ? t(`progressStage_${stage}`)
                          : t('progressQueued')}
                    </strong>
                  </article>
                );
              })}
            </div>
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
              <span className="font-medium text-ink">{stageLabel}</span>
              <span className="tabular-nums text-ink-muted">
                {t('progressElapsed', { seconds: elapsedSec })}
              </span>
            </div>
            <div className="grid gap-1.5">
              <button
                type="button"
                className="kh-ops-text-btn justify-self-start text-left"
                onClick={() => setDetailsOpen((open) => !open)}
              >
                {detailsOpen ? t('progressDetailsHide') : t('progressDetailsShow')}
              </button>
              {detailsOpen ? (
                <pre
                  ref={detailsLogRef}
                  className="m-0 max-h-48 overflow-auto whitespace-pre-wrap rounded-[3px] border border-line bg-canvas p-2 font-mono text-xs text-ink-muted"
                >
                  {doc.progressLog?.trim() || t('progressDetailsEmpty')}
                </pre>
              ) : null}
            </div>
          </div>
        ) : null}
      </Panel>

      {doc.media.length > 0 ? (
        <Panel>
          <h3 className="mt-0 mb-2 text-base font-medium">{t('extractedImages')}</h3>
          <ul className="m-0 grid list-none gap-2 p-0">
            {doc.media.map((m) => (
              <li key={m.workspaceMediaId}>
                <a href={m.url} className="text-sm text-brand no-underline">
                  {m.originalFilename ?? m.workspaceMediaId}
                </a>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {warnings.length > 0 ? (
        <Panel>
          <h3 className="mt-0 mb-2 text-base font-medium">{t('secretWarnings')}</h3>
          <ul className="m-0 grid list-none gap-1 p-0 text-sm">
            {warnings.map((w) => (
              <li key={w.code}>
                <Badge tone={w.severity === 'high' ? 'danger' : 'warn'}>
                  {w.severity}
                </Badge>{' '}
                {w.label} × {w.count}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {doc.linkedRecords.length > 0 ? (
        <section className="kh-ops-panel">
          <div className="kh-ops-panel-head">
            <h3 className="kh-ops-panel-title">{t('linkedDrafts')}</h3>
          </div>
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
                {doc.linkedRecords.map((r) => (
                  <tr key={r.knowledgeRecordId}>
                    <td className="kh-ops-primary-cell">
                      <Link
                        href={`/workspaces/${props.workspaceSlug}/records/${r.slug}`}
                        className="no-underline"
                      >
                        {r.title}
                      </Link>
                    </td>
                    <td>
                      <span className="kh-ops-type-chip">{r.recordType}</span>
                    </td>
                    <td>{lifecycleLabel(r.lifecycleStatus, tRecords)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {props.canMutate && ready && !doc.archivedAt ? (
        <Panel>
          <h3 className="mt-0 mb-3 text-base font-medium">{t('createDraft')}</h3>
          <form className="grid gap-4" onSubmit={onCreateDraft}>
            <Field label={tCommon('title')}>
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
                {RECORD_TYPE_CATALOG.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('markdown')}>
              <Textarea
                value={contentMarkdown}
                onChange={(e) => setContentMarkdown(e.target.value)}
                rows={16}
                required
              />
            </Field>
            <Field label={t('excerptNote')}>
              <Input
                value={excerptNote}
                onChange={(e) => setExcerptNote(e.target.value)}
              />
            </Field>
            {hasHigh ? (
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={acknowledgeSecrets}
                  onChange={(e) => setAcknowledgeSecrets(e.target.checked)}
                />
                <span>{t('acknowledgeSecrets')}</span>
              </label>
            ) : null}
            {error ? <ErrorText>{error}</ErrorText> : null}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={pending || (hasHigh && !acknowledgeSecrets)}>
                {pending ? tCommon('saving') : t('createDraft')}
              </Button>
              <Link
                href={`/workspaces/${props.workspaceSlug}`}
                className="self-center text-sm text-ink-muted no-underline"
              >
                {t('backToWorkspace')}
              </Link>
            </div>
          </form>
        </Panel>
      ) : null}
    </div>
  );
}
