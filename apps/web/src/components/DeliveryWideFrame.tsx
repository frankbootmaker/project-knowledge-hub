'use client';

import type { ReactNode } from 'react';
import { Modal } from './ui';

/** Full-window chart viewer, the same size as the document wide viewer. */
export function DeliveryWideFrame({
  open,
  title,
  description,
  className,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  description: string;
  className: string;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!open) return children;
  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      description={description}
      size="full"
      panelClassName="kh-ops-chart-modal"
      bodyClassName="!block overflow-auto"
    >
      <div className={className}>{children}</div>
    </Modal>
  );
}
