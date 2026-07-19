import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/cn';

export function Panel({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLElement> & { children: ReactNode }) {
  return (
    <section className={cn('kh-panel', className)} {...props}>
      {children}
    </section>
  );
}
