import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';
import { buttonClassName, type ButtonVariant } from './buttonStyles';

type Props = Omit<ComponentProps<typeof Link>, 'className'> & {
  variant?: ButtonVariant;
  className?: string;
  children: ReactNode;
};

/** Next.js Link styled like Button — use instead of copying button class soup. */
export function LinkButton({
  variant = 'primary',
  className,
  children,
  ...props
}: Props) {
  return (
    <Link className={buttonClassName(variant, className)} {...props}>
      {children}
    </Link>
  );
}
