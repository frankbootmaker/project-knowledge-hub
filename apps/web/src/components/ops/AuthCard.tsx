import type { ReactNode } from 'react';
import { LanguageSwitcher } from '../LanguageSwitcher';
import { ThemeSwitcher } from '../ThemeSwitcher';
import { defaultTheme, type AppTheme } from '../../lib/theme';

export function AuthCard({
  brand,
  eyebrow,
  title,
  subtitle,
  children,
  theme = defaultTheme,
}: {
  brand: string;
  eyebrow?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  theme?: AppTheme;
}) {
  return (
    <div className="kh-ops-auth-page">
      <div className="mb-4 flex w-full max-w-[440px] items-center justify-end gap-2">
        <ThemeSwitcher initialTheme={theme} />
        <LanguageSwitcher />
      </div>
      <section className="kh-ops-auth-card">
        <div className="kh-ops-auth-brand">
          <span className="kh-ops-brand-symbol">KH</span>
          {brand}
        </div>
        <div className="kh-ops-auth-body">
          {eyebrow ? <p className="kh-ops-eyebrow">{eyebrow}</p> : null}
          <h1>{title}</h1>
          {subtitle ? <p className="kh-ops-subtitle mt-0">{subtitle}</p> : null}
          {children}
        </div>
      </section>
    </div>
  );
}
