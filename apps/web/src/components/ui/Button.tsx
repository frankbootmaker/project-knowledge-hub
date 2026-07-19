import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { buttonClassName, type ButtonVariant } from './buttonStyles';

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: ButtonVariant;
    children: ReactNode;
  }
>(function Button({ variant = 'primary', className, children, ...props }, ref) {
  return (
    <button
      ref={ref}
      className={buttonClassName(variant, className)}
      {...props}
    >
      {children}
    </button>
  );
});
