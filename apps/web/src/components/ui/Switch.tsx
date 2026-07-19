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
      <label htmlFor={switchId} className="text-sm text-ink">
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
          'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30',
          'disabled:cursor-not-allowed disabled:opacity-50',
          checked
            ? 'border-brand bg-brand'
            : 'border-line-strong bg-neutral-soft',
        )}
      >
        <span
          className={cn(
            'inline-block size-4 rounded-full bg-panel-solid shadow transition',
            checked ? 'translate-x-6' : 'translate-x-1',
          )}
        />
      </button>
    </div>
  );
}
