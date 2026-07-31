'use client';

import { useId, useRef, type InputHTMLAttributes } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '../../lib/cn';
import { Button } from './Button';

type FilePickerProps = {
  accept?: string;
  disabled?: boolean;
  className?: string;
  /** Current file name to display (controlled). */
  fileName?: string | null;
  onFileChange: (file: File | null) => void;
  id?: string;
  name?: string;
} & Pick<InputHTMLAttributes<HTMLInputElement>, 'aria-label'>;

/**
 * Replaces the native file control (Browse / Tallózás) with a secondary Button
 * plus filename — consistent across locales and browsers.
 */
export function FilePicker({
  accept,
  disabled,
  className,
  fileName,
  onFileChange,
  id,
  name,
  'aria-label': ariaLabel,
}: FilePickerProps) {
  const t = useTranslations('common');
  const autoId = useId();
  const inputId = id ?? autoId;
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className={cn('flex min-w-0 flex-wrap items-center gap-3', className)}>
      <input
        ref={inputRef}
        id={inputId}
        name={name}
        type="file"
        accept={accept}
        disabled={disabled}
        className="sr-only"
        tabIndex={-1}
        aria-label={ariaLabel ?? t('browse')}
        onChange={(event) => {
          onFileChange(event.target.files?.[0] ?? null);
          event.target.value = '';
        }}
      />
      <Button
        type="button"
        variant="secondary"
        disabled={disabled}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          inputRef.current?.click();
        }}
      >
        {t('browse')}
      </Button>
      <span className="min-w-0 flex-1 truncate text-sm text-ink-muted">
        {fileName ? fileName : t('noFileChosen')}
      </span>
    </div>
  );
}
