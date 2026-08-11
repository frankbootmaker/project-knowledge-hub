'use client';

import { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { downloadAuthenticatedExport } from '../lib/download-export';
import {
  consumeTranslationSse,
  type TranslationStreamStage,
} from '../lib/translation-sse';
import { localeLabels, locales, type AppLocale } from '../i18n/config';
import { ArchiveEntityButton } from './ArchiveEntityButton';
import { PurgeEntityButton } from './PurgeEntityButton';
import {
  ManageDetailRow,
  ManageMenuItem,
  ManageMenuLink,
  ManageToolbar,
} from './manage-menu-shared';
import {
  Button,
  ErrorText,
  Field,
  Modal,
  Panel,
  Select,
  lifecycleLabel,
  useToast,
} from './ui';

export type RecordManageDetails = {
  id: string;
  title: string;
  slug: string;
  summary: string | null;
  recordType: string;
  humanKey?: string | null;
  language?: string | null;
  lifecycleStatus: string;
  sourceOfTruthMode: string;
  currentVersionNumber: number;
  createdAt?: string;
  updatedAt: string;
  archivedAt: string | null;
  tags: Array<{ name: string }>;
  projectName?: string | null;
  systemName?: string | null;
  verifiedAt?: string | null;
  reviewedBy?: string | null;
  reviewedByUser?: {
    id: string;
    displayName: string;
    email: string;
  } | null;
  lastValidatedAt?: string | null;
  source?: {
    sourceType: string;
    sourceProvider: string | null;
    sourceReference: string | null;
    sourceTitle: string | null;
    sourceUri: string | null;
    generatedByModel: string | null;
  } | null;
};

type Section = 'menu' | 'details' | 'export' | 'translate' | 'archive' | 'delete';
type ExportFormat = 'pdf' | 'docx' | 'xlsx' | 'md';

type StylePackOption = {
  id: string;
  label: string;
  builtin: boolean;
};

type TranslationSibling = {
  id: string;
  slug: string;
  language: string | null;
  title: string;
  lifecycleStatus: string;
};

export function KnowledgeRecordManageMenu(props: {
  workspaceSlug: string;
  workspaceId: string;
  record: RecordManageDetails;
  canMutate: boolean;
  canPurge: boolean;
  /** VISION_LLM_BASE_URL set — shows Translate with AI checkbox. */
  visionConfigured?: boolean;
  /** When set, Edit opens the wide editor modal instead of navigating. */
  onEdit?: () => void;
}) {
  const t = useTranslations('records');
  const tCommon = useTranslations('common');
  const tArchive = useTranslations('archive');
  const locale = useLocale();
  const router = useRouter();
  const { pushToast } = useToast();
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<Section>('menu');
  const [exportPending, setExportPending] = useState(false);
  const [stylePacks, setStylePacks] = useState<StylePackOption[]>([
    { id: 'blank', label: 'Blank', builtin: true },
  ]);
  const [stylePackId, setStylePackId] = useState('blank');
  const [siblings, setSiblings] = useState<TranslationSibling[]>([]);
  const [targetLanguage, setTargetLanguage] = useState<AppLocale>('hu');
  const [translateWithAi, setTranslateWithAi] = useState(false);
  const [translatePending, setTranslatePending] = useState(false);
  const [translateError, setTranslateError] = useState<string | null>(null);
  const [translateStage, setTranslateStage] =
    useState<TranslationStreamStage | null>(null);
  const [translateModel, setTranslateModel] = useState<string | null>(null);
  const [translateElapsedSec, setTranslateElapsedSec] = useState(0);
  const [translateLog, setTranslateLog] = useState('');
  const [translateDetailsOpen, setTranslateDetailsOpen] = useState(false);
  const translateLogRef = useRef<HTMLPreElement | null>(null);
  const translateStartedAtRef = useRef<number | null>(null);
  /** Auto-open Details on the first token only; later deltas must not override Hide. */
  const translateDetailsAutoOpenedRef = useRef(false);
  const [deleteSelectedIds, setDeleteSelectedIds] = useState<string[]>([]);
  const [deleteConfirming, setDeleteConfirming] = useState(false);
  const [deleteAcknowledged, setDeleteAcknowledged] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const archived = Boolean(props.record.archivedAt);
  const gitManaged = props.record.sourceOfTruthMode === 'git_managed';
  const redirectParent = `/workspaces/${props.workspaceSlug}`;
  const editHref = `/workspaces/${props.workspaceSlug}/records/${props.record.slug}/edit`;
  const historyHref = `/workspaces/${props.workspaceSlug}/records/${props.record.slug}/history`;
  const canTranslate = props.canMutate && !archived && !gitManaged;
  const availableTranslationLocales = locales.filter(
    (code) =>
      !siblings.some(
        (item) => (item.language ?? 'en').toLowerCase() === code,
      ),
  );
  const noFurtherTranslations = availableTranslationLocales.length === 0;

  useEffect(() => {
    if (!open || section !== 'export') {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(
          `/api/v1/doc-factory/style-packs?workspaceId=${props.workspaceId}`,
          { credentials: 'include' },
        );
        if (!response.ok || cancelled) {
          return;
        }
        const body = (await response.json()) as {
          stylePacks: StylePackOption[];
        };
        if (!cancelled && body.stylePacks.length > 0) {
          setStylePacks(body.stylePacks);
        }
      } catch {
        // Keep Blank default when the list cannot load.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, section, props.workspaceId]);

  useEffect(() => {
    if (!open || (section !== 'translate' && section !== 'delete')) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(
          `/api/v1/knowledge-records/${props.record.id}/translations`,
          { credentials: 'include' },
        );
        if (!response.ok || cancelled) {
          return;
        }
        const body = (await response.json()) as {
          translations: TranslationSibling[];
        };
        if (cancelled) return;
        setSiblings(body.translations);
        if (section === 'translate') {
          const taken = new Set(
            body.translations.map((item) =>
              (item.language ?? 'en').toLowerCase(),
            ),
          );
          const next = locales.find((code) => !taken.has(code)) ?? 'en';
          setTargetLanguage(next);
        }
        if (section === 'delete') {
          setDeleteSelectedIds([props.record.id]);
          setDeleteConfirming(false);
          setDeleteAcknowledged(false);
          setDeleteError(null);
        }
      } catch {
        // Ignore load failures; actions will surface errors.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, section, props.record.id]);

  function resetTranslateProgress() {
    setTranslateStage(null);
    setTranslateModel(null);
    setTranslateElapsedSec(0);
    setTranslateLog('');
    setTranslateDetailsOpen(false);
    translateStartedAtRef.current = null;
    translateDetailsAutoOpenedRef.current = false;
  }

  function close() {
    setOpen(false);
    setSection('menu');
    setTranslateError(null);
    setTranslateWithAi(false);
    resetTranslateProgress();
    setDeleteConfirming(false);
    setDeleteAcknowledged(false);
    setDeleteError(null);
  }

  function siblingLanguageLabel(code: string | null): string {
    const normalized = (code ?? 'en').toLowerCase();
    if (locales.includes(normalized as AppLocale)) {
      return localeLabels[normalized as AppLocale];
    }
    return normalized.toUpperCase();
  }

  async function purgeSelectedTranslations() {
    if (deleteSelectedIds.length === 0) {
      setDeleteError(t('manageDeleteNoneSelected'));
      return;
    }
    if (!deleteAcknowledged) {
      return;
    }
    setDeletePending(true);
    setDeleteError(null);
    try {
      const remaining = siblings.filter(
        (item) => !deleteSelectedIds.includes(item.id),
      );
      for (const id of deleteSelectedIds) {
        const response = await fetch(
          `/api/v1/knowledge-records/${id}/purge`,
          {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
              Origin: window.location.origin,
            },
            body: JSON.stringify({ confirmDestroy: true }),
          },
        );
        if (!response.ok && response.status !== 204) {
          const payload = (await response.json()) as {
            error?: { message?: string };
          };
          throw new Error(payload.error?.message ?? tArchive('failedDelete'));
        }
      }
      close();
      if (deleteSelectedIds.includes(props.record.id)) {
        const next = remaining[0];
        if (next) {
          router.push(
            `/workspaces/${props.workspaceSlug}/records/${next.slug}`,
          );
        } else {
          router.push(redirectParent);
        }
      }
      router.refresh();
    } catch (err) {
      setDeleteError(
        err instanceof Error ? err.message : tArchive('failedDelete'),
      );
    } finally {
      setDeletePending(false);
    }
  }

  function sectionTitle(): string {
    if (section === 'menu') return t('manageTitle');
    if (section === 'details') return t('manageDetails');
    if (section === 'export') return t('manageExport');
    if (section === 'translate') return t('manageTranslate');
    if (section === 'delete') return t('manageDelete');
    return archived ? t('manageRestore') : t('manageArchive');
  }

  useEffect(() => {
    if (!translatePending) {
      return;
    }
    translateStartedAtRef.current = Date.now();
    setTranslateElapsedSec(0);
    const timer = window.setInterval(() => {
      const started = translateStartedAtRef.current;
      if (started == null) {
        return;
      }
      setTranslateElapsedSec(Math.floor((Date.now() - started) / 1000));
    }, 250);
    return () => window.clearInterval(timer);
  }, [translatePending]);

  useEffect(() => {
    const el = translateLogRef.current;
    if (!el || !translateDetailsOpen) {
      return;
    }
    el.scrollTop = el.scrollHeight;
  }, [translateLog, translateDetailsOpen]);

  function translateStageLabel(stage: TranslationStreamStage): string {
    if (stage === 'preparing') return t('translateStagePreparing');
    if (stage === 'calling_model') return t('translateStageCallingModel');
    if (stage === 'retrying') return t('translateStageRetrying');
    return t('translateStageSaving');
  }

  async function createTranslation() {
    setTranslatePending(true);
    setTranslateError(null);
    resetTranslateProgress();
    setTranslateStage('preparing');
    let completedSlug: string | null = null;
    let streamError: string | null = null;
    try {
      const response = await fetch(
        `/api/v1/knowledge-records/${props.record.id}/translations/stream`,
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
            Origin: window.location.origin,
          },
          body: JSON.stringify({
            language: targetLanguage,
            translateWithAi: translateWithAi || undefined,
          }),
        },
      );
      await consumeTranslationSse(response, {
        onStage: (stage) => {
          setTranslateStage(stage.stage);
          if (stage.model) {
            setTranslateModel(stage.model);
          }
          // Drop the failed fast-path echo from Details before the real attempt.
          if (stage.stage === 'retrying') {
            setTranslateLog('');
          }
        },
        onLlmDelta: (text) => {
          setTranslateLog((prev) => prev + text);
          if (!translateDetailsAutoOpenedRef.current) {
            translateDetailsAutoOpenedRef.current = true;
            setTranslateDetailsOpen(true);
          }
        },
        onDone: (record) => {
          completedSlug = record.slug;
        },
        onError: (error) => {
          streamError = error.message;
        },
      });
      if (streamError) {
        throw new Error(streamError);
      }
      if (!completedSlug) {
        throw new Error(t('translateFailed'));
      }
      pushToast(
        translateWithAi ? t('translateAiCreated') : t('translateCreated'),
      );
      close();
      router.push(
        `/workspaces/${props.workspaceSlug}/records/${completedSlug}`,
      );
      router.refresh();
    } catch (err) {
      setTranslateError(err instanceof Error ? err.message : t('translateFailed'));
    } finally {
      setTranslatePending(false);
    }
  }

  async function exportRecord(format: ExportFormat) {
    setExportPending(true);
    try {
      const styleQuery =
        format === 'pdf' || format === 'docx'
          ? `&stylePackId=${encodeURIComponent(stylePackId)}`
          : '';
      await downloadAuthenticatedExport(
        `/api/v1/knowledge-records/${props.record.id}/export?format=${format}&locale=${encodeURIComponent(locale)}${styleQuery}`,
        `${props.record.slug}.${format}`,
      );
      pushToast(t('exportOk', { format: format.toUpperCase() }));
      close();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : t('exportFailed');
      pushToast(message, 'danger');
    } finally {
      setExportPending(false);
    }
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
            <ManageMenuItem
              title={t('manageExport')}
              hint={t('manageExportHint')}
              onClick={() => setSection('export')}
            />
            {props.canMutate && !archived && !gitManaged ? (
              props.onEdit ? (
                <ManageMenuItem
                  title={t('manageEdit')}
                  hint={t('manageEditHint')}
                  onClick={() => {
                    close();
                    props.onEdit?.();
                  }}
                />
              ) : (
                <ManageMenuLink
                  href={editHref}
                  title={t('manageEdit')}
                  hint={t('manageEditHint')}
                  onClick={close}
                />
              )
            ) : null}
            {canTranslate ? (
              <ManageMenuItem
                title={t('manageTranslate')}
                hint={t('manageTranslateHint')}
                onClick={() => setSection('translate')}
              />
            ) : null}
            <ManageMenuLink
              href={historyHref}
              title={t('history')}
              hint={t('manageHistoryHint')}
              onClick={close}
            />
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

        {section === 'export' ? (
          <ul className="m-0 grid list-none gap-2 p-0">
            <li className="grid gap-1 rounded-md border border-line bg-surface px-3 py-2">
              <label
                className="text-xs font-medium text-ink-muted"
                htmlFor="export-style-pack"
              >
                {t('exportStylePack')}
              </label>
              <select
                id="export-style-pack"
                className="rounded border border-line bg-canvas px-2 py-1.5 text-sm text-ink"
                value={stylePackId}
                disabled={exportPending}
                onChange={(event) => setStylePackId(event.target.value)}
              >
                {stylePacks.map((pack) => (
                  <option key={pack.id} value={pack.id}>
                    {pack.label}
                    {pack.builtin ? ` (${t('exportStylePackBlank')})` : ''}
                  </option>
                ))}
              </select>
              <p className="m-0 text-xs text-ink-muted">{t('exportStylePackHint')}</p>
            </li>
            <ManageMenuItem
              title={t('exportPdf')}
              hint={t('exportPdfHint')}
              disabled={exportPending}
              onClick={() => void exportRecord('pdf')}
            />
            <ManageMenuItem
              title={t('exportDocx')}
              hint={t('exportDocxHint')}
              disabled={exportPending}
              onClick={() => void exportRecord('docx')}
            />
            <ManageMenuItem
              title={t('exportXlsx')}
              hint={t('exportXlsxHint')}
              disabled={exportPending}
              onClick={() => void exportRecord('xlsx')}
            />
            <ManageMenuItem
              title={t('exportMarkdown')}
              hint={t('exportMarkdownHint')}
              disabled={exportPending}
              onClick={() => void exportRecord('md')}
            />
            <li>
              <Button
                type="button"
                variant="secondary"
                disabled={exportPending}
                onClick={() => setSection('menu')}
              >
                {tCommon('back')}
              </Button>
            </li>
          </ul>
        ) : null}

        {section === 'translate' ? (
          <div className="grid gap-4">
            {noFurtherTranslations ? (
              <>
                <p className="m-0 text-sm text-ink-muted">{t('translateAllExist')}</p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setSection('menu')}
                  >
                    {tCommon('back')}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p className="m-0 text-sm text-ink-muted">
                  {t('manageTranslateBlurb')}
                </p>
                <Field label={t('contentLanguage')}>
                  <Select
                    value={
                      availableTranslationLocales.includes(targetLanguage)
                        ? targetLanguage
                        : availableTranslationLocales[0]!
                    }
                    onChange={(e) =>
                      setTargetLanguage(e.target.value as AppLocale)
                    }
                    disabled={translatePending}
                  >
                    {availableTranslationLocales.map((code) => (
                      <option key={code} value={code}>
                        {localeLabels[code]} ({code})
                      </option>
                    ))}
                  </Select>
                </Field>
                {props.visionConfigured ? (
                  <label className="flex items-start gap-2 text-sm text-ink">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={translateWithAi}
                      disabled={translatePending}
                      onChange={(e) => setTranslateWithAi(e.target.checked)}
                    />
                    <span>
                      <span className="font-medium">{t('translateWithAi')}</span>
                      <span className="mt-0.5 block text-ink-muted">
                        {t('translateWithAiHint')}
                      </span>
                    </span>
                  </label>
                ) : (
                  <p className="m-0 text-sm text-ink-muted">
                    {t('translateAiUnavailable')}
                  </p>
                )}
                {translatePending ? (
                  <div className="grid gap-2 rounded-md border border-line bg-canvas-muted/40 p-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                      <span className="font-medium text-ink">
                        {translateStage
                          ? translateStageLabel(translateStage)
                          : t('translateAiPending')}
                        {translateModel ? (
                          <span className="font-normal text-ink-muted">
                            {' '}
                            · {translateModel}
                          </span>
                        ) : null}
                      </span>
                      <span className="tabular-nums text-ink-muted">
                        {t('translateElapsed', { seconds: translateElapsedSec })}
                      </span>
                    </div>
                    <div
                      className="kh-translate-progress"
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={t('translateAiPending')}
                    >
                      <div className="kh-translate-progress-bar" />
                    </div>
                    {translateWithAi ? (
                      <div className="grid gap-1.5">
                        <button
                          type="button"
                          className="justify-self-start text-left text-sm font-medium text-ink underline-offset-2 hover:underline"
                          onClick={() =>
                            setTranslateDetailsOpen((openDetails) => !openDetails)
                          }
                        >
                          {translateDetailsOpen
                            ? t('translateDetailsHide')
                            : t('translateDetailsShow')}
                        </button>
                        {translateDetailsOpen ? (
                          <pre
                            ref={translateLogRef}
                            className="m-0 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded border border-line bg-canvas p-2 font-mono text-xs text-ink"
                          >
                            {translateLog || t('translateDetailsEmpty')}
                          </pre>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {translateError ? (
                  <div className="grid gap-2">
                    <ErrorText>{translateError}</ErrorText>
                    {translateLog ? (
                      <details className="text-sm">
                        <summary className="cursor-pointer font-medium text-ink">
                          {t('translateDetailsShow')}
                        </summary>
                        <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded border border-line bg-canvas p-2 font-mono text-xs text-ink">
                          {translateLog}
                        </pre>
                      </details>
                    ) : null}
                  </div>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    disabled={translatePending}
                    onClick={() => void createTranslation()}
                  >
                    {translatePending
                      ? translateWithAi
                        ? t('translateAiPending')
                        : tCommon('saving')
                      : t('translateCreate')}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={translatePending}
                    onClick={() => setSection('menu')}
                  >
                    {tCommon('back')}
                  </Button>
                </div>
              </>
            )}
          </div>
        ) : null}

        {section === 'details' ? (
          <div className="grid gap-4">
            <dl className="m-0 grid gap-3">
              <ManageDetailRow label={t('detailsId')} value={props.record.id} mono />
              {props.record.humanKey ? (
                <ManageDetailRow
                  label={t('detailsHumanKey')}
                  value={props.record.humanKey}
                  mono
                />
              ) : null}
              <ManageDetailRow label={t('detailsSlug')} value={props.record.slug} mono />
              <ManageDetailRow
                label={tCommon('summary')}
                value={props.record.summary?.trim() || tCommon('noSummary')}
              />
              <ManageDetailRow label={t('recordType')} value={props.record.recordType} />
              <ManageDetailRow
                label={t('contentLanguage')}
                value={props.record.language ?? 'en'}
              />
              <ManageDetailRow
                label={t('lifecycleStatus')}
                value={lifecycleLabel(props.record.lifecycleStatus, t)}
              />
              <ManageDetailRow
                label={t('sourceOfTruth')}
                value={props.record.sourceOfTruthMode}
              />
              <ManageDetailRow
                label={tCommon('project')}
                value={props.record.projectName ?? tCommon('none')}
              />
              <ManageDetailRow
                label={tCommon('system')}
                value={props.record.systemName ?? tCommon('none')}
              />
              <ManageDetailRow
                label={tCommon('tags')}
                value={
                  props.record.tags.length > 0
                    ? props.record.tags.map((tag) => tag.name).join(', ')
                    : tCommon('none')
                }
              />
              <ManageDetailRow
                label={t('sourceType')}
                value={props.record.source?.sourceType ?? tCommon('emDash')}
              />
              <ManageDetailRow
                label={t('sourceTitle')}
                value={props.record.source?.sourceTitle ?? tCommon('emDash')}
              />
              <ManageDetailRow
                label={t('provider')}
                value={props.record.source?.sourceProvider ?? tCommon('emDash')}
              />
              <ManageDetailRow
                label={t('reference')}
                value={props.record.source?.sourceReference ?? tCommon('emDash')}
              />
              <ManageDetailRow
                label={t('uri')}
                value={props.record.source?.sourceUri ?? tCommon('emDash')}
              />
              <ManageDetailRow
                label={t('model')}
                value={props.record.source?.generatedByModel ?? tCommon('emDash')}
              />
              <ManageDetailRow
                label={t('verifiedAt')}
                value={
                  props.record.verifiedAt
                    ? new Date(props.record.verifiedAt).toLocaleString()
                    : tCommon('emDash')
                }
              />
              <ManageDetailRow
                label={t('reviewedBy')}
                value={
                  props.record.reviewedByUser
                    ? props.record.reviewedByUser.email
                      ? `${props.record.reviewedByUser.displayName} (${props.record.reviewedByUser.email})`
                      : props.record.reviewedByUser.displayName
                    : (props.record.reviewedBy ?? tCommon('emDash'))
                }
              />
              <ManageDetailRow
                label={t('lastValidated')}
                value={
                  props.record.lastValidatedAt
                    ? new Date(props.record.lastValidatedAt).toLocaleString()
                    : tCommon('emDash')
                }
              />
              <ManageDetailRow
                label={tCommon('updated')}
                value={new Date(props.record.updatedAt).toLocaleString()}
              />
            </dl>
            <Button type="button" variant="secondary" onClick={() => setSection('menu')}>
              {tCommon('back')}
            </Button>
          </div>
        ) : null}

        {section === 'archive' ? (
          <div className="grid gap-4">
            <p className="m-0 text-sm text-ink-muted">
              {archived ? t('manageRestoreHint') : t('manageArchiveHint')}
            </p>
            <ArchiveEntityButton
              kind="record"
              entityId={props.record.id}
              entityName={props.record.title}
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
            {siblings.length >= 2 ? (
              <>
                <p className="m-0 text-sm text-ink-muted">
                  {t('manageDeleteFamilyHint')}
                </p>
                <ul className="m-0 grid list-none gap-2 p-0">
                  {siblings.map((item) => {
                    const checked = deleteSelectedIds.includes(item.id);
                    const lang = siblingLanguageLabel(item.language);
                    return (
                      <li key={item.id}>
                        <label className="flex items-start gap-2 rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink">
                          <input
                            type="checkbox"
                            className="mt-0.5"
                            checked={checked}
                            disabled={deletePending}
                            onChange={(event) => {
                              setDeleteSelectedIds((prev) =>
                                event.target.checked
                                  ? [...new Set([...prev, item.id])]
                                  : prev.filter((id) => id !== item.id),
                              );
                            }}
                          />
                          <span>
                            {t('manageDeleteSiblingLabel', {
                              language: `${lang} (${(item.language ?? 'en').toLowerCase()})`,
                              title: item.title,
                            })}
                            {item.id === props.record.id ? (
                              <span className="mt-0.5 block text-xs text-ink-muted">
                                {t('current')}
                              </span>
                            ) : null}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={deletePending}
                    onClick={() =>
                      setDeleteSelectedIds(siblings.map((item) => item.id))
                    }
                  >
                    {t('manageDeleteSelectAll')}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={deletePending}
                    onClick={() => setDeleteSelectedIds([])}
                  >
                    {t('manageDeleteSelectNone')}
                  </Button>
                </div>
                {!deleteConfirming ? (
                  <Button
                    type="button"
                    variant="danger"
                    disabled={deletePending || deleteSelectedIds.length === 0}
                    onClick={() => {
                      setDeleteConfirming(true);
                      setDeleteAcknowledged(false);
                      setDeleteError(null);
                    }}
                  >
                    {t('manageDeleteSelected')}
                  </Button>
                ) : (
                  <Panel variant="inset" className="grid w-full gap-3">
                    <p className="m-0 text-sm text-danger">
                      {t('manageDeleteConfirmSelected', {
                        count: deleteSelectedIds.length,
                      })}
                    </p>
                    <p className="m-0 text-xs text-ink-muted">
                      {tArchive('deleteHintRecord')}
                    </p>
                    {gitManaged ? (
                      <p className="m-0 text-xs text-ink-muted">
                        {tArchive('deleteHintRecordGitManaged')}
                      </p>
                    ) : null}
                    <label className="flex items-start gap-2 text-sm text-ink">
                      <input
                        type="checkbox"
                        checked={deleteAcknowledged}
                        disabled={deletePending}
                        onChange={(event) =>
                          setDeleteAcknowledged(event.target.checked)
                        }
                      />
                      <span>{tArchive('deleteAcknowledge')}</span>
                    </label>
                    {deleteError ? <ErrorText>{deleteError}</ErrorText> : null}
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="danger"
                        disabled={deletePending || !deleteAcknowledged}
                        onClick={() => void purgeSelectedTranslations()}
                      >
                        {deletePending
                          ? tArchive('deletingPermanently')
                          : tArchive('confirmDeleteAction')}
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={deletePending}
                        onClick={() => {
                          setDeleteConfirming(false);
                          setDeleteAcknowledged(false);
                          setDeleteError(null);
                        }}
                      >
                        {tCommon('cancel')}
                      </Button>
                    </div>
                  </Panel>
                )}
              </>
            ) : (
              <>
                <p className="m-0 text-sm text-ink-muted">{t('manageDeleteHint')}</p>
                <PurgeEntityButton
                  kind="record"
                  entityId={props.record.id}
                  entityName={props.record.title}
                  redirectOnPurge={redirectParent}
                  extraHint={
                    gitManaged ? tArchive('deleteHintRecordGitManaged') : null
                  }
                />
              </>
            )}
            <Button
              type="button"
              variant="secondary"
              disabled={deletePending}
              onClick={() => setSection('menu')}
            >
              {tCommon('back')}
            </Button>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
