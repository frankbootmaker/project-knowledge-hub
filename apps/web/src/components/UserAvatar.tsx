'use client';

import { useEffect, useState } from 'react';
import { cn } from '../lib/cn';
import { userMonogram } from '../lib/monogram';

const sizeClass = {
  xs: 'size-6 text-[10px]',
  sm: 'size-8 text-xs',
  md: 'size-12 text-sm',
  lg: 'size-20 text-xl',
} as const;

export function UserAvatar({
  displayName,
  fullName,
  avatarUrl,
  size = 'md',
  className,
}: {
  displayName: string;
  fullName?: string | null;
  avatarUrl?: string | null;
  size?: keyof typeof sizeClass;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  // A prior 404/onError must not stick after upload (new ?v=) or remove.
  useEffect(() => {
    setFailed(false);
  }, [avatarUrl]);

  const showImage = Boolean(avatarUrl) && !failed;
  const monogram = userMonogram(displayName, fullName);

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full',
        'border border-line bg-brand-soft font-semibold text-brand',
        sizeClass[size],
        className,
      )}
      aria-hidden={!showImage}
    >
      {showImage ? (
        // Same-origin /api proxy sends session cookie automatically.
        <img
          src={avatarUrl!}
          alt=""
          className="size-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <span>{monogram}</span>
      )}
    </span>
  );
}
