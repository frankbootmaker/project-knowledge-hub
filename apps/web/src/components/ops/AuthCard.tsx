import type { ReactNode } from 'react';
import { LandingLangSegment } from '../landing/LandingLangSegment';
import { LandingThemeSegment } from '../landing/LandingThemeSegment';
import { defaultTheme, type ThemePreference } from '../../lib/theme';

export function AuthCard({
  brand,
  eyebrow,
  title,
  subtitle,
  children,
  themePreference = defaultTheme,
}: {
  brand: string;
  eyebrow?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  themePreference?: ThemePreference;
}) {
  return (
    <div className="kh-ops-auth-page">
      <div className="kh-ops-auth-controls">
        <LandingThemeSegment initialPreference={themePreference} />
        <LandingLangSegment />
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
