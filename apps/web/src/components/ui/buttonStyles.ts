import { cn } from '../../lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'success' | 'danger';

const variantClass: Record<ButtonVariant, string> = {
  primary: 'kh-btn-primary',
  secondary: 'kh-btn-secondary',
  ghost: 'kh-btn-ghost',
  success: 'kh-btn-success',
  danger: 'kh-btn-danger',
};

/** Shared classes for Button and LinkButton — change once in globals.css recipes. */
export function buttonClassName(
  variant: ButtonVariant = 'primary',
  className?: string,
): string {
  return cn('kh-btn', variantClass[variant], className);
}
