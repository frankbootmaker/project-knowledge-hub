'use client';

import { useState, type InputHTMLAttributes } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '../../lib/cn';

function EyeIcon({ open }: { open: boolean }) {
  if (open) {
    return (
      <svg
        viewBox="0 0 24 24"
        width="1.125rem"
        height="1.125rem"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    );
  }

  return (
    <svg
      viewBox="0 0 24 24"
      width="1.125rem"
      height="1.125rem"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 3l18 18" />
      <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
      <path d="M9.9 5.1A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a17.5 17.5 0 0 1-1.7 2.5" />
      <path d="M6.1 6.1A17.3 17.3 0 0 0 2 12s3.5 7 10 7a10.4 10.4 0 0 0 4.2-.9" />
    </svg>
  );
}

export function PasswordInput({
  className,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const t = useTranslations('common');
  const [visible, setVisible] = useState(false);

  return (
    <span className="relative block">
      <input
        {...props}
        type={visible ? 'text' : 'password'}
        className={cn('kh-input pr-11', className)}
      />
      <button
        type="button"
        className={cn(
          'absolute top-1/2 right-1.5 flex size-9 -translate-y-1/2 items-center justify-center',
          'rounded-md text-ink-muted transition hover:bg-brand-soft hover:text-ink',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30',
        )}
        aria-label={visible ? t('hidePassword') : t('showPassword')}
        aria-pressed={visible}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setVisible((current) => !current);
        }}
      >
        <EyeIcon open={visible} />
      </button>
    </span>
  );
}
