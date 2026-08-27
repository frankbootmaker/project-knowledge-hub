'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { ThemePreference } from '../../lib/theme';
import {
  AUTH_DESKTOP_MQ,
  authPathForMode,
  type AuthMode,
} from './auth-mode';
import { AuthModal } from './AuthModal';
import { LandingLangSegment } from './LandingLangSegment';
import { LandingThemeSegment } from './LandingThemeSegment';

function BrandLink({ className }: { className?: string }) {
  return (
    <Link className={`kh-lp-brand ${className ?? ''}`.trim()} href="/" aria-label="KnowHub home">
      <span className="kh-lp-mark" aria-hidden>
        KH
      </span>
      <span className="kh-lp-brand-name">KnowHub</span>
    </Link>
  );
}

export function LandingPage({
  themePreference,
  initialAuthMode = null,
}: {
  themePreference: ThemePreference;
  /** When set (desktop auth routes), open that modal immediately. */
  initialAuthMode?: AuthMode | null;
}) {
  const t = useTranslations('landing');
  const router = useRouter();
  const [authMode, setAuthMode] = useState<AuthMode | null>(initialAuthMode);

  const openAuth = useCallback(
    (mode: AuthMode) => {
      if (typeof window !== 'undefined' && window.matchMedia(AUTH_DESKTOP_MQ).matches) {
        setAuthMode(mode);
        return;
      }
      router.push(authPathForMode(mode));
    },
    [router],
  );

  return (
    <div className="kh-landing">
      <header className="kh-lp-header">
        <div className="kh-lp-shell kh-lp-header-inner">
          <BrandLink />
          <div className="kh-lp-header-actions">
            <LandingThemeSegment initialPreference={themePreference} />
            <LandingLangSegment />
            <button
              type="button"
              className="kh-lp-text-link kh-lp-header-signin"
              onClick={() => openAuth('login')}
            >
              {t('signIn')}
            </button>
            <button
              type="button"
              className="kh-lp-button kh-lp-button-primary"
              onClick={() => openAuth('register')}
            >
              {t('requestAccess')}
            </button>
          </div>
        </div>
      </header>

      <main className="kh-lp-main">
        <section className="kh-lp-hero">
          <div className="kh-lp-shell">
            <p className="kh-lp-eyebrow">{t('eyebrow')}</p>
            <div className="kh-lp-hero-grid">
              <h1>{t('headline')}</h1>
              <div className="kh-lp-hero-copy">
                <p>{t('heroBody')}</p>
                <div className="kh-lp-hero-actions">
                  <button
                    type="button"
                    className="kh-lp-button kh-lp-button-primary"
                    onClick={() => openAuth('register')}
                  >
                    {t('requestAccess')}
                  </button>
                  <button
                    type="button"
                    className="kh-lp-button kh-lp-button-secondary"
                    onClick={() => openAuth('login')}
                  >
                    {t('signIn')}
                  </button>
                </div>
              </div>
            </div>
            <div className="kh-lp-hero-meta" aria-label="Product scope">
              <div className="kh-lp-meta-item">
                <strong>{t('metaOneTitle')}</strong>
                <span>{t('metaOneBody')}</span>
              </div>
              <div className="kh-lp-meta-item">
                <strong>{t('metaTwoTitle')}</strong>
                <span>{t('metaTwoBody')}</span>
              </div>
              <div className="kh-lp-meta-item">
                <strong>{t('metaThreeTitle')}</strong>
                <span>{t('metaThreeBody')}</span>
              </div>
            </div>
          </div>
        </section>

        <section className="kh-lp-section">
          <div className="kh-lp-shell">
            <div className="kh-lp-section-heading">
              <span className="kh-lp-section-index">01 / TOGETHER</span>
              <h2>{t('audienceTitle')}</h2>
            </div>
            <div className="kh-lp-audience-grid">
              <article className="kh-lp-audience-card">
                <div className="kh-lp-card-label">{t('peopleLabel')}</div>
                <h3>{t('peopleTitle')}</h3>
                <p>{t('peopleBody')}</p>
                <ul className="kh-lp-clean-list">
                  <li>{t('control')}</li>
                  <li>{t('catalogue')}</li>
                  <li>{t('delivery')}</li>
                  <li>{t('budget')}</li>
                  <li>{t('stakeholders')}</li>
                </ul>
              </article>
              <article className="kh-lp-audience-card">
                <div className="kh-lp-card-label">{t('aiLabel')}</div>
                <h3>{t('aiTitle')}</h3>
                <p>{t('aiBody')}</p>
                <ul className="kh-lp-clean-list">
                  <li>{t('mcp')}</li>
                  <li>{t('scopedAccess')}</li>
                  <li>{t('sharedKnowledge')}</li>
                  <li>{t('audit')}</li>
                </ul>
              </article>
            </div>
          </div>
        </section>

        <section className="kh-lp-section kh-lp-pillars">
          <div className="kh-lp-shell">
            <div className="kh-lp-section-heading">
              <span className="kh-lp-section-index">02 / CAPABILITIES</span>
              <h2>{t('pillarsTitle')}</h2>
            </div>
            <div className="kh-lp-pillar-grid">
              <article className="kh-lp-pillar-card">
                <span className="kh-lp-pillar-number">01</span>
                <h3>{t('knowledgeTitle')}</h3>
                <p>{t('knowledgeBody')}</p>
              </article>
              <article className="kh-lp-pillar-card">
                <span className="kh-lp-pillar-number">02</span>
                <h3>{t('deliveryTitle')}</h3>
                <p>{t('deliveryBody')}</p>
              </article>
              <article className="kh-lp-pillar-card">
                <span className="kh-lp-pillar-number">03</span>
                <h3>{t('systemsTitle')}</h3>
                <p>{t('systemsBody')}</p>
              </article>
              <article className="kh-lp-pillar-card">
                <span className="kh-lp-pillar-number">04</span>
                <h3>{t('workspacesTitle')}</h3>
                <p>{t('workspacesBody')}</p>
              </article>
            </div>
          </div>
        </section>

        <section className="kh-lp-section">
          <div className="kh-lp-shell">
            <div className="kh-lp-section-heading">
              <span className="kh-lp-section-index">03 / START</span>
              <h2>{t('stepsTitle')}</h2>
            </div>
            <div className="kh-lp-steps">
              <article className="kh-lp-step">
                <h3>{t('stepOneTitle')}</h3>
                <p>{t('stepOneBody')}</p>
              </article>
              <article className="kh-lp-step">
                <h3>{t('stepTwoTitle')}</h3>
                <p>{t('stepTwoBody')}</p>
              </article>
              <article className="kh-lp-step">
                <h3>{t('stepThreeTitle')}</h3>
                <p>{t('stepThreeBody')}</p>
              </article>
            </div>
          </div>
        </section>

        <section className="kh-lp-closing">
          <div className="kh-lp-shell kh-lp-closing-inner">
            <h2>{t('closingTitle')}</h2>
            <button
              type="button"
              className="kh-lp-button kh-lp-button-primary"
              onClick={() => openAuth('register')}
            >
              {t('requestAccess')}
            </button>
          </div>
        </section>
      </main>

      <footer className="kh-lp-footer">
        <div className="kh-lp-shell kh-lp-footer-inner">
          <BrandLink />
          <nav className="kh-lp-footer-links" aria-label="Footer">
            <button type="button" className="kh-lp-text-link" onClick={() => openAuth('login')}>
              {t('signIn')}
            </button>
            <button
              type="button"
              className="kh-lp-text-link"
              onClick={() => openAuth('register')}
            >
              {t('requestAccess')}
            </button>
            <span className="kh-lp-footer-lang">EN / DE / HU</span>
          </nav>
        </div>
      </footer>

      <AuthModal
        open={authMode !== null}
        mode={authMode ?? 'login'}
        onModeChange={setAuthMode}
        onClose={() => setAuthMode(null)}
      />
    </div>
  );
}
