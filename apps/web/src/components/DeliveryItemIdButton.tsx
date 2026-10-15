'use client';

import type { MouseEvent, ReactNode } from 'react';

type DeliveryItemIdButtonProps = {
  variant: 'key' | 'type';
  children: ReactNode;
  onClick: () => void;
  className?: string;
  title?: string;
};

export function DeliveryItemIdButton({
  variant,
  children,
  onClick,
  className,
  title,
}: DeliveryItemIdButtonProps) {
  const chipClass = variant === 'key' ? 'kh-ops-key-badge' : 'kh-ops-type-chip';

  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    onClick();
  }

  return (
    <button
      type="button"
      className={className ? `${chipClass} ${className}` : chipClass}
      title={title}
      onClick={handleClick}
      onMouseDown={(event) => event.stopPropagation()}
    >
      {children}
    </button>
  );
}
