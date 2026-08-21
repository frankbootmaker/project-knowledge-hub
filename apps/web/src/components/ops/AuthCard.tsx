import type { ReactNode } from 'react';
import { LanguageSwitcher } from '../LanguageSwitcher';

export function AuthCard({
  brand,
  eyebrow,
  title,
  subtitle,
  children,
}: {
  brand: string;
  eyebrow?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="kh-ops-auth-page">
      <div className="mb-4 flex w-full max-w-[440px] justify-end">
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
