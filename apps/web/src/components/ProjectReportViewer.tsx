'use client';

import { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { renderMarkdown } from '@project-knowledge-hub/markdown';
import { MarkdownDocument } from './MarkdownDocument';
import { Button, ErrorText, Modal, useToast } from './ui';
import { downloadAuthenticatedExport } from '../lib/download-export';
import { downloadProjectReport } from '../lib/project-reports';

export type ProjectReportKind = 'delivery' | 'stakeholders' | 'status';

export function ProjectReportViewer({
  open,
  onClose,
  projectName,
  projectId,
  kind,
  title,
  markdown,
  loading,
  error,
}: {
  open: boolean;
  onClose: () => void;
  projectName: string;
  projectId: string;
  kind: ProjectReportKind | null;
  title: string;
  markdown: string;
  loading: boolean;
  error: string | null;
}) {
  const t = useTranslations('projects');
  const locale = useLocale();
  const { pushToast } = useToast();
  const printRef = useRef<HTMLDivElement>(null);
  const [html, setHtml] = useState('');
  const [toc, setToc] = useState<Array<{ id: string; text: string; depth: number }>>(
    [],
  );
  const [renderError, setRenderError] = useState<string | null>(null);
  const [exportPending, setExportPending] = useState(false);

  useEffect(() => {
    if (!open || !markdown) {
      setHtml('');
      setToc([]);
      setRenderError(null);
      return;
    }
    let cancelled = false;
    void renderMarkdown(markdown)
      .then((result) => {
        if (cancelled) return;
        setHtml(result.html);
        setToc(result.toc);
        setRenderError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setRenderError(
          err instanceof Error ? err.message : t('reportFailed'),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [open, markdown, t]);

  function downloadMarkdown() {
    if (!kind || !markdown) return;
    downloadProjectReport(projectName, kind, markdown);
    pushToast(t('reportDownloaded'));
  }

  async function exportPdf() {
    if (!kind || !markdown) return;
    setExportPending(true);
    try {
      await downloadAuthenticatedExport(
        `/api/v1/projects/${projectId}/reports/export`,
        `${projectName.replace(/[^\w.-]+/g, '-').toLowerCase()}-${kind}.pdf`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: window.location.origin,
          },
          body: JSON.stringify({
            title,
            markdown,
            format: 'pdf',
            kind,
            locale,
          }),
        },
      );
      pushToast(t('reportPdfDownloaded'));
    } catch (err) {
      pushToast(
        err instanceof Error ? err.message : t('reportPdfFailed'),
        'danger',
      );
    } finally {
      setExportPending(false);
    }
  }

  function printReport() {
    const node = printRef.current;
    if (!node) return;
    const printWindow = window.open('', '_blank', 'noopener,noreferrer');
    if (!printWindow) {
      pushToast(t('reportPrintBlocked'), 'danger');
      return;
    }
    printWindow.document.write(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${title.replace(/</g, '')}</title>
  <style>
    body { font-family: Georgia, "Times New Roman", serif; color: #111; margin: 2rem; line-height: 1.5; }
    h1, h2, h3 { font-family: system-ui, sans-serif; }
    a { color: inherit; }
    pre, code { font-family: ui-monospace, monospace; font-size: 0.9em; }
    ul { padding-left: 1.25rem; }
  </style>
</head>
<body>${node.innerHTML}</body>
</html>`);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title || t('manageReports')}
      description={t('reportViewerDescription')}
      size="full"
      bodyClassName="!block overflow-auto"
      footer={
        <div className="kh-ops-action-line w-full border-0 p-0">
          <p className="m-0 text-xs text-ink-muted">{t('reportViewerHint')}</p>
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            <Button
              type="button"
              variant="secondary"
              disabled={loading || !markdown || exportPending}
              onClick={downloadMarkdown}
            >
              {t('reportDownloadMd')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={loading || !markdown || exportPending}
              onClick={() => void exportPdf()}
            >
              {exportPending ? t('reportExportingPdf') : t('reportExportPdf')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={loading || !html || exportPending}
              onClick={printReport}
            >
              {t('reportPrint')}
            </Button>
            <Button type="button" variant="secondary" onClick={onClose}>
              {t('reportClose')}
            </Button>
          </div>
        </div>
      }
    >
      {error || renderError ? (
        <div className="mb-3">
          <ErrorText>{error || renderError}</ErrorText>
        </div>
      ) : null}
      {loading ? (
        <p className="kh-ops-empty">{t('reportLoading')}</p>
      ) : html ? (
        <div ref={printRef} className="project-report-print-root">
          <MarkdownDocument html={html} toc={toc} title={title} />
        </div>
      ) : null}
    </Modal>
  );
}
