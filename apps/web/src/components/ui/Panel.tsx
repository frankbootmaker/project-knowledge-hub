import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/cn';

type PanelVariant = 'default' | 'solid' | 'inset';

const variants: Record<PanelVariant, string> = {
  default: 'kh-panel',
  solid: 'kh-panel-solid',
  inset: 'kh-panel-inset',
};

export function Panel({
  variant = 'default',
  className,
  children,
  ...props
}: HTMLAttributes<HTMLElement> & {
  variant?: PanelVariant;
  children: ReactNode;
}) {
  return (
    <section className={cn(variants[variant], className)} {...props}>
      {children}
    </section>
  );
}
