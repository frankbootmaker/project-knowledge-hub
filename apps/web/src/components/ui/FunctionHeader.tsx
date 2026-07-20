import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

/**
 * Toolbar row for list/admin screens: search + filters on the left,
 * primary actions (e.g. Create) on the right — same line on wide viewports.
 */
export function FunctionHeader({
  search,
  filters,
  actions,
  className,
}: {
  search?: ReactNode;
  filters?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  const hasControls = search != null || filters != null;

  return (
    <div className={cn('kh-function-header', className)}>
      {hasControls ? (
        <div className="kh-function-header-controls">
          {search}
          {filters}
        </div>
      ) : null}
      {actions != null ? (
        <div className="kh-function-header-actions">{actions}</div>
      ) : null}
    </div>
  );
}
