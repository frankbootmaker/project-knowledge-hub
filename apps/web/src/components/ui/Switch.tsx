'use client';

import { cn } from '../../lib/cn';

export function Switch({
  checked,
  onCheckedChange,
  label,
  disabled,
  id,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
  id?: string;
}) {
  const switchId = id ?? 'kh-switch';

  return (
    <div className="flex items-center justify-between gap-3">
      <label
        htmlFor={switchId}
        className="text-xs font-semibold tracking-wide text-ink"
      >
        {label}
      </label>
      <button
        id={switchId}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onCheckedChange(!checked)}
        className={cn(
          'relative inline-flex shrink-0 items-center rounded-md border transition',
          'h-[var(--kh-control-height)] w-[var(--kh-control-width)]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--kh-focus-ring)]',
          'disabled:cursor-not-allowed disabled:opacity-50',
          checked
            ? 'border-transparent bg-accent-soft'
            : 'border-line-strong bg-neutral-soft',
        )}
      >
        <span
          className={cn(
            'inline-block size-3 rounded-sm shadow-sm transition',
            checked
              ? 'translate-x-[1.05rem] bg-accent'
              : 'translate-x-0.5 bg-ink-muted/50',
          )}
        />
      </button>
    </div>
  );
}
