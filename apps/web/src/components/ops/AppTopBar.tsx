'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '../../lib/cn';
import {
  findActiveNavItem,
  headerCrumbs,
  parseAppPath,
  type NavContext,
} from '../../lib/ops-nav';
import { readLastProject, readLastWorkspace } from '../../lib/ops-prefs';
import type { ThemePreference } from '../../lib/theme';
import { LandingLangSegment } from '../landing/LandingLangSegment';
import { LandingThemeSegment } from '../landing/LandingThemeSegment';
import type { ShellWorkspace } from './AppRail';
import { MenuGlyphIcon, SearchGlyphIcon } from './NavIcons';

export function AppTopBar({
  workspaces,
  isAdmin,
  themePreference,
  onOpenRail,
}: {
  workspaces: ShellWorkspace[];
  isAdmin: boolean;
  themePreference: ThemePreference;
  onOpenRail: () => void;
}) {
  const t = useTranslations('nav');
  const tCommon = useTranslations('common');
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [hash, setHash] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [lastWorkspace, setLastWorkspace] = useState<string | null>(null);
  const [lastProject, setLastProject] = useState<{
    workspaceSlug: string;
    projectSlug: string;
  } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLastWorkspace(readLastWorkspace());
    setLastProject(readLastProject());
  }, []);

  useEffect(() => {
    const sync = () => setHash(window.location.hash.replace(/^#/, ''));
    sync();
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, [pathname]);

  useEffect(() => {
    setCreateOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!createOpen) {
      return;
    }
    function onPointer(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setCreateOpen(false);
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setCreateOpen(false);
      }
    }
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [createOpen]);

  const pathParts = parseAppPath(pathname);
  const ctx: NavContext = useMemo(() => {
    const workspaceSlug =
      pathParts.workspaceSlug
      || lastProject?.workspaceSlug
      || lastWorkspace
      || workspaces[0]?.slug
      || null;
    const projectSlug =
      pathParts.projectSlug
      || (lastProject && lastProject.workspaceSlug === workspaceSlug
        ? lastProject.projectSlug
        : null);
    return { workspaceSlug, projectSlug, isAdmin };
  }, [
    pathParts.workspaceSlug,
    pathParts.projectSlug,
    lastProject,
    lastWorkspace,
    workspaces,
    isAdmin,
  ]);

  const search = searchParams.toString() ? `?${searchParams.toString()}` : '';
  const activeItem = findActiveNavItem(ctx, pathname, hash, search);
  const workspace = workspaces.find((row) => row.slug === ctx.workspaceSlug);
  const crumbs = headerCrumbs(pathname, {
    workspaceName: workspace?.name,
  });
  const title = activeItem ? t(activeItem.labelKey) : tCommon('appName');

  const createHref = ctx.workspaceSlug
    ? `/workspaces/${ctx.workspaceSlug}/projects/new`
    : '/workspaces/new';
  const createLabel = ctx.workspaceSlug ? t('createProject') : t('createWorkspace');

  return (
    <>
      <div className="kh-ops-mobile-bar">
        <Link href="/dashboard" className="kh-ops-brand">
          <span className="kh-ops-brand-symbol">KH</span>
          {t('brandShort')}
        </Link>
        <button
          type="button"
          className="kh-ops-icon-btn"
          aria-label={t('openMenu')}
          onClick={onOpenRail}
        >
          <MenuGlyphIcon />
        </button>
      </div>
      <header className="kh-ops-subhead">
        <div>
          <div className="kh-ops-crumb">
            {crumbs.map((crumb, index) => (
              <span key={crumb.href}>
                {index > 0 ? ' / ' : null}
                <Link href={crumb.href}>{crumb.label}</Link>
              </span>
            ))}
          </div>
          <h2 className="kh-ops-view-name">{title}</h2>
        </div>
        <div className="kh-ops-sub-actions">
          <div className="kh-ops-display-controls">
            <LandingThemeSegment initialPreference={themePreference} />
            <LandingLangSegment />
          </div>
          <Link
            href="/search"
            className="kh-ops-icon-btn"
            aria-label={t('search')}
            title={t('search')}
          >
            <SearchGlyphIcon />
          </Link>
          <div className="kh-ops-header-menu-wrap" ref={menuRef}>
            <button
              type="button"
              className="kh-ops-secondary-btn kh-ops-header-menu-trigger"
              aria-haspopup="menu"
              aria-expanded={createOpen}
              onClick={() => setCreateOpen((value) => !value)}
            >
              <span className="kh-ops-create-sync-label">{t('createSync')}</span>
              <span aria-hidden>⌄</span>
            </button>
            <div
              className={cn('kh-ops-header-menu', createOpen && 'open')}
              role="menu"
            >
              <span className="kh-ops-menu-section-label">
                {t('workspaceOps')}
              </span>
              {ctx.workspaceSlug ? (
                <>
                  <Link
                    href={`/workspaces/${ctx.workspaceSlug}/projects/new`}
                    role="menuitem"
                  >
                    {t('createProject')}
                  </Link>
                  <Link
                    href={`/workspaces/${ctx.workspaceSlug}/systems/new`}
                    role="menuitem"
                  >
                    {t('createSystem')}
                  </Link>
                </>
              ) : null}
              <Link href="/workspaces/new" role="menuitem">
                {t('createWorkspace')}
              </Link>
              {ctx.workspaceSlug ? (
                <>
                  <div className="kh-ops-menu-rule" />
                  <Link
                    href={`/workspaces/${ctx.workspaceSlug}/git`}
                    role="menuitem"
                  >
                    {t('gitSync')}
                  </Link>
                  <Link
                    href={`/workspaces/${ctx.workspaceSlug}/imports`}
                    role="menuitem"
                  >
                    {t('importDetail')}
                  </Link>
                </>
              ) : null}
            </div>
          </div>
          <Link href={createHref} className="kh-ops-primary-btn">
            {createLabel}
          </Link>
        </div>
      </header>
    </>
  );
}
