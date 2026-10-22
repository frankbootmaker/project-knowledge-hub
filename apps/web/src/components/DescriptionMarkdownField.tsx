'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { renderMarkdown } from '@project-knowledge-hub/markdown';
import { cn } from '../lib/cn';
import { MarkdownView } from './MarkdownDocument';
import { Textarea } from './ui';

/** Last Raw / Rendered choice for delivery descriptions, per browser profile. */
export const DESCRIPTION_MARKDOWN_MODE_KEY = 'kh.descriptionMarkdown.mode';

const MODE_EVENT = 'kh-description-markdown-mode';

export type DescriptionMarkdownMode = 'raw' | 'rendered';

function readStoredMode(): DescriptionMarkdownMode {
  if (typeof window === 'undefined') {
    return 'rendered';
  }
  try {
    return window.localStorage.getItem(DESCRIPTION_MARKDOWN_MODE_KEY) === 'raw'
      ? 'raw'
      : 'rendered';
  } catch {
    return 'rendered';
  }
}

function storeMode(mode: DescriptionMarkdownMode) {
  try {
    window.localStorage.setItem(DESCRIPTION_MARKDOWN_MODE_KEY, mode);
  } catch {
    // Private mode or a full quota should not block the view.
  }
  window.dispatchEvent(new CustomEvent(MODE_EVENT, { detail: mode }));
}

function RenderedDescription({ markdown, label }: { markdown: string; label: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    void renderMarkdown(markdown).then(
      (result) => {
        if (!cancelled) {
          setHtml(result.html);
        }
      },
      () => {
        if (!cancelled) {
          setHtml(null);
          setFailed(true);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [markdown]);

  if (failed) {
    return (
      <pre className="kh-input kh-ops-description-raw" aria-label={label}>
        {markdown}
      </pre>
    );
  }

  return (
    <div className="kh-ops-description-markdown" aria-busy={html == null} aria-label={label}>
      {html != null ? <MarkdownView html={html} /> : null}
    </div>
  );
}

export function DescriptionMarkdownField({
  label,
  value,
  onChange,
  disabled = false,
  readOnly = false,
  rows = 4,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Save in progress. The textarea stays, but cannot be edited. */
  disabled?: boolean;
  /** Detail view without edit rights. Raw is read-only text. */
  readOnly?: boolean;
  rows?: number;
  className?: string;
}) {
  const t = useTranslations('delivery');
  const fieldId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const focusRaw = useRef(false);
  const [mode, setMode] = useState<DescriptionMarkdownMode>('rendered');
  // Keep the textarea mounted while the user is typing into an empty field
  // whose saved preference is Rendered.
  const [pinnedRaw, setPinnedRaw] = useState(false);

  useEffect(() => {
    setMode(readStoredMode());
    function onMode(event: Event) {
      const detail = (event as CustomEvent<unknown>).detail;
      if (detail === 'raw' || detail === 'rendered') {
        setMode(detail);
      }
    }
    window.addEventListener(MODE_EVENT, onMode);
    return () => window.removeEventListener(MODE_EVENT, onMode);
  }, []);

  const empty = value.trim().length === 0;
  const showRendered = !empty && mode === 'rendered' && !pinnedRaw;
  const displayed: DescriptionMarkdownMode = showRendered ? 'rendered' : 'raw';
  const showTextarea = displayed === 'raw' && (!readOnly || empty);

  useEffect(() => {
    if (!focusRaw.current || !showTextarea) {
      return;
    }
    focusRaw.current = false;
    textareaRef.current?.focus();
  }, [showTextarea]);

  function choose(next: DescriptionMarkdownMode) {
    setPinnedRaw(false);
    setMode(next);
    storeMode(next);
    focusRaw.current = next === 'raw' && !readOnly;
  }

  return (
    <div className={cn('kh-label', className)} data-markdown-mode={displayed}>
      <span className="kh-ops-description-label-row">
        <span>{label}</span>
        {empty ? null : (
          <span className="kh-ops-description-mode" role="group" aria-label={t('descriptionView')}>
            <button
              type="button"
              className="kh-ops-type-chip"
              aria-pressed={displayed === 'raw'}
              onClick={() => choose('raw')}
            >
              {t('descriptionRaw')}
            </button>
            <button
              type="button"
              className="kh-ops-type-chip"
              aria-pressed={displayed === 'rendered'}
              onClick={() => choose('rendered')}
            >
              {t('descriptionRendered')}
            </button>
          </span>
        )}
      </span>
      {showRendered ? <RenderedDescription markdown={value} label={label} /> : null}
      {displayed === 'raw' && readOnly && !empty ? (
        <pre className="kh-input kh-ops-description-raw" aria-label={label}>
          {value}
        </pre>
      ) : null}
      {showTextarea ? (
        <Textarea
          ref={textareaRef}
          id={fieldId}
          aria-label={label}
          value={value}
          rows={rows}
          disabled={disabled || readOnly}
          onChange={(event) => onChange(event.target.value)}
          onFocus={() => {
            if (mode === 'rendered') {
              setPinnedRaw(true);
            }
          }}
          onBlur={() => setPinnedRaw(false)}
        />
      ) : null}
    </div>
  );
}
