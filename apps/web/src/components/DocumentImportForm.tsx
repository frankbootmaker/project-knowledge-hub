'use client';

import type { DragEvent, FormEvent, KeyboardEvent } from 'react';
import { useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import {
  DOCUMENT_IMPORT_OCR_ENGINES,
  DOCUMENT_IMPORT_OCR_LANGS,
  ocrLangFromUiLocale,
  type DocumentImportOcrEngine,
  type DocumentImportOcrLang,
} from '@project-knowledge-hub/document-import';
import {
  Button,
  ErrorText,
  Field,
  Input,
  Panel,
  Select,
} from './ui';

type Option = { id: string; name: string; slug: string };

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DocumentImportForm(props: {
  workspaceId: string;
  workspaceSlug: string;
  lane: 'document' | 'image';
  projects: Option[];
  systems: Option[];
  defaultOcrEngine?: DocumentImportOcrEngine;
  visionConfigured?: boolean;
}) {
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations('documentImports');
  const tCommon = useTranslations('common');
  const inputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState('');
  const [projectId, setProjectId] = useState('');
  const [systemId, setSystemId] = useState('');
  const [ocrEngine, setOcrEngine] = useState<DocumentImportOcrEngine>(
    props.defaultOcrEngine ?? 'none',
  );
  const [ocrLang, setOcrLang] = useState<DocumentImportOcrLang>(() =>
    ocrLangFromUiLocale(locale),
  );
  useEffect(() => {
    setOcrLang(ocrLangFromUiLocale(locale));
  }, [locale]);
  const [file, setFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function assignFile(next: File | null) {
    setFile(next);
    setError(null);
    if (fileInputRef.current) {
      if (!next) {
        fileInputRef.current.value = '';
      }
    }
  }

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  function onDropZoneKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openFilePicker();
    }
  }

  function onDragEnter(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(true);
  }

  function onDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(true);
  }

  function onDragLeave(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    const next = event.relatedTarget as Node | null;
    if (next && event.currentTarget.contains(next)) return;
    setDragActive(false);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(false);
    const dropped = event.dataTransfer.files?.[0] ?? null;
    if (dropped) assignFile(dropped);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) {
      setError(t('needFile'));
      return;
    }
    setPending(true);
    setError(null);

    try {
      const form = new FormData();
      form.set('workspaceId', props.workspaceId);
      form.set('lane', props.lane);
      form.set('ocrEngine', ocrEngine);
      form.set('ocrLang', ocrLang);
      if (title.trim()) form.set('title', title.trim());
      if (projectId) form.set('projectId', projectId);
      if (systemId) form.set('systemId', systemId);
      form.set('file', file);

      const response = await fetch('/api/v1/document-imports', {
        method: 'POST',
        credentials: 'include',
        body: form,
      });
      const payload = (await response.json()) as {
        documentImport?: { id: string };
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? t('failedCreate'));
      }
      router.push(
        `/workspaces/${props.workspaceSlug}/document-imports/${payload.documentImport?.id ?? ''}`,
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('failedCreate'));
    } finally {
      setPending(false);
    }
  }

  const accept =
    props.lane === 'image'
      ? 'image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif'
      : '.pdf,.docx,.pptx,.xlsx,.html,.md,.txt,application/pdf';

  return (
    <Panel>
      <form className="grid min-w-0 gap-4" onSubmit={onSubmit}>
        <p className="m-0 text-sm text-ink-muted">
          {props.lane === 'image' ? t('imageHelp') : t('documentHelp')}
        </p>
        <Field label={t('titleOptional')}>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('titlePlaceholder')}
          />
        </Field>
        <Field label={t('file')} className="min-w-0">
          <input
            ref={fileInputRef}
            id={inputId}
            type="file"
            accept={accept}
            className="sr-only"
            tabIndex={-1}
            onChange={(e) => assignFile(e.target.files?.[0] ?? null)}
          />
          <div
            role="button"
            tabIndex={0}
            aria-controls={inputId}
            aria-label={t('dropzoneAria')}
            onClick={openFilePicker}
            onKeyDown={onDropZoneKeyDown}
            onDragEnter={onDragEnter}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            className={[
              'flex min-h-44 w-full min-w-0 cursor-pointer flex-col items-center justify-center gap-2',
              'overflow-hidden rounded-lg border-2 border-dashed px-4 py-10 text-center transition sm:px-6',
              dragActive
                ? 'border-brand bg-brand-soft/60'
                : 'border-line-strong bg-panel-solid/60 hover:border-brand hover:bg-brand-soft/40',
            ].join(' ')}
          >
            <p className="m-0 max-w-full text-base font-medium text-ink">
              {dragActive ? t('dropzoneActive') : t('dropzoneTitle')}
            </p>
            <p className="m-0 max-w-full text-sm text-ink-muted">{t('dropzoneHint')}</p>
            {file ? (
              <p className="m-0 mt-2 w-full min-w-0 max-w-full break-words rounded-md bg-panel-solid px-3 py-1.5 text-sm text-ink">
                <span className="block break-all [overflow-wrap:anywhere]">{file.name}</span>
                <span className="text-ink-muted"> · {formatBytes(file.size)}</span>
              </p>
            ) : null}
          </div>
        </Field>
        <Field label={t('ocrEngine')}>
          <Select
            value={ocrEngine}
            onChange={(e) =>
              setOcrEngine(e.target.value as DocumentImportOcrEngine)
            }
          >
            {DOCUMENT_IMPORT_OCR_ENGINES.map((engine) => (
              <option
                key={engine}
                value={engine}
                disabled={
                  engine === 'vision' && props.visionConfigured === false
                }
              >
                {t(`ocrEngine_${engine}`)}
              </option>
            ))}
          </Select>
          <p className="m-0 mt-1 text-sm text-ink-muted">{t('ocrEngineHelp')}</p>
        </Field>
        {ocrEngine === 'tesseract' || ocrEngine === 'vision' ? (
          <Field label={t('ocrLang')}>
            <Select
              value={ocrLang}
              onChange={(e) =>
                setOcrLang(e.target.value as DocumentImportOcrLang)
              }
            >
              {DOCUMENT_IMPORT_OCR_LANGS.map((lang) => (
                <option key={lang} value={lang}>
                  {t(`ocrLang_${lang}`)}
                </option>
              ))}
            </Select>
            <p className="m-0 mt-1 text-sm text-ink-muted">{t('ocrLangHelp')}</p>
          </Field>
        ) : null}
        <Field label={tCommon('project')}>
          <Select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
          >
            <option value="">{tCommon('none')}</option>
            {props.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={tCommon('system')}>
          <Select
            value={systemId}
            onChange={(e) => setSystemId(e.target.value)}
          >
            <option value="">{tCommon('none')}</option>
            {props.systems.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        {error ? <ErrorText>{error}</ErrorText> : null}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={() =>
              router.push(`/workspaces/${props.workspaceSlug}`)
            }
          >
            {tCommon('cancel')}
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? t('uploading') : t('upload')}
          </Button>
        </div>
      </form>
    </Panel>
  );
}
