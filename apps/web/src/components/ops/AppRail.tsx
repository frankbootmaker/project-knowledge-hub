'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { cn } from '../../lib/cn';
import { logoutAction } from '../../lib/logout-action';
import { userMonogram } from '../../lib/monogram';
import {
  findActiveNavItem,
  inferNavSection,
  NAV_SECTIONS,
  parseAppPath,
  parseNavSection,
  type NavContext,
  type NavSectionId,
} from '../../lib/ops-nav';
import {
  readLastProject,
  readLastWorkspace,
  readRailCompact,
  writeLastProject,
  writeLastWorkspace,
  writeNavSection,
  writeRailCompact,
} from '../../lib/ops-prefs';
import type { SessionPayload } from '../../lib/session';
import { UserAvatar } from '../UserAvatar';
import { NavIcon, RailModeIcon, SearchGlyphIcon } from './NavIcons';

export type ShellWorkspace = {
  id: string;
  slug: string;
  name: string;
};

export function AppRail({
  session,
  workspaces,
  compact,
  onCompactChange,
  open,
  onOpenChange,
}: {
  session: SessionPayload;
  workspaces: ShellWorkspace[];
  compact: boolean;
  onCompactChange: (value: boolean) => void;
  open: boolean;
  onOpenChange: (value: boolean) => void;
}) {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const jumpId = useId();
  const search = searchParams.toString() ? `?${searchParams.toString()}` : '';
  const [section, setSection] = useState<NavSectionId>(() =>
    inferNavSection(pathname, '', search),
  );
  const [jump, setJump] = useState('');
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [hash, setHash] = useState('');
  const [lastWorkspace, setLastWorkspace] = useState<string | null>(null);
  const [lastProject, setLastProject] = useState<{
    workspaceSlug: string;
    projectSlug: string;
  } | null>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);

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

  const pathParts = parseAppPath(pathname);
  useEffect(() => {
    if (pathParts.workspaceSlug) {
      writeLastWorkspace(pathParts.workspaceSlug);
      setLastWorkspace(pathParts.workspaceSlug);
    }
    if (pathParts.workspaceSlug && pathParts.projectSlug) {
      const pref = {
        workspaceSlug: pathParts.workspaceSlug,
        projectSlug: pathParts.projectSlug,
      };
      writeLastProject(pref);
      setLastProject(pref);
    }
  }, [pathParts.workspaceSlug, pathParts.projectSlug]);

  useEffect(() => {
    const inferred = inferNavSection(pathname, hash, search);
    setSection(inferred);
    writeNavSection(inferred);
  }, [pathname, hash, search]);

  useEffect(() => {
    onOpenChange(false);
    setUserOpen(false);
    setWorkspaceOpen(false);
    setJump('');
  }, [pathname, onOpenChange]);

  useEffect(() => {
    if (!userOpen) {
      return;
    }
    function onPointer(event: MouseEvent) {
      if (!userMenuRef.current?.contains(event.target as Node)) {
        setUserOpen(false);
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setUserOpen(false);
      }
    }
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [userOpen]);

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
    return {
      workspaceSlug,
      projectSlug,
      isAdmin: session.user.isSystemAdmin,
    };
  }, [
    pathParts.workspaceSlug,
    pathParts.projectSlug,
    lastProject,
    lastWorkspace,
    workspaces,
    session.user.isSystemAdmin,
  ]);

  const visibleSections = NAV_SECTIONS.filter(
    (item) => !item.adminOnly || ctx.isAdmin,
  );
  const activeItem = findActiveNavItem(ctx, pathname, hash, search);
  const currentWorkspace =
    workspaces.find((row) => row.slug === ctx.workspaceSlug) ?? workspaces[0];

  const jumpHits = useMemo(() => {
    const query = jump.trim().toLowerCase();
    if (!query) {
      return [];
    }
    const hits: Array<{ href: string; label: string; section: string }> = [];
    for (const group of visibleSections) {
      for (const item of group.items) {
        if (item.adminOnly && !ctx.isAdmin) {
          continue;
        }
        const label = t(item.labelKey);
        const sectionLabel = t(group.labelKey);
        if (
          label.toLowerCase().includes(query)
          || sectionLabel.toLowerCase().includes(query)
        ) {
          hits.push({
            href: item.href(ctx),
            label,
            section: sectionLabel,
          });
        }
      }
    }
    return hits.slice(0, 12);
  }, [jump, visibleSections, ctx, t]);

  function selectSection(next: NavSectionId) {
    setSection(parseNavSection(next));
    writeNavSection(next);
    setJump('');
  }

  const monogram = userMonogram(
    session.user.displayName,
    session.user.fullName,
  );

  return (
    <>
      <button
        type="button"
        className="kh-ops-rail-backdrop"
        aria-label={t('closeMenu')}
        aria-hidden={!open}
        tabIndex={open ? 0 : -1}
        onClick={() => onOpenChange(false)}
      />
      <aside className={cn('kh-ops-rail', jump.trim() && 'searching')}>
        <div className="kh-ops-brand-row">
          <Link href="/dashboard" className="kh-ops-brand">
            <span className="kh-ops-brand-symbol">KH</span>
            <span className="kh-ops-brand-name">{t('brandShort')}</span>
          </Link>
          <button
            type="button"
            className="kh-ops-rail-mode"
            title={t('toggleCompact')}
            aria-label={t('toggleCompact')}
            aria-pressed={compact}
            onClick={() => {
              const next = !compact;
              onCompactChange(next);
              writeRailCompact(next);
            }}
          >
            <RailModeIcon />
          </button>
        </div>

        <div className="relative">
          <button
            type="button"
            className="kh-ops-workspace-select"
            aria-expanded={workspaceOpen}
            aria-haspopup="listbox"
            onClick={() => setWorkspaceOpen((value) => !value)}
          >
            <small>{t('workspace')}</small>
            <strong>
              {currentWorkspace?.name ?? t('allWorkspaces')}
              <span aria-hidden>⌄</span>
            </strong>
          </button>
          <div className={cn('kh-ops-workspace-menu', workspaceOpen && 'open')}>
            <Link
              href="/workspaces"
              className={!ctx.workspaceSlug ? 'active' : undefined}
              onClick={() => setWorkspaceOpen(false)}
            >
              {t('allWorkspaces')}
            </Link>
            {workspaces.map((workspace) => (
              <Link
                key={workspace.id}
                href={`/workspaces/${workspace.slug}`}
                className={
                  workspace.slug === ctx.workspaceSlug ? 'active' : undefined
                }
                onClick={() => {
                  writeLastWorkspace(workspace.slug);
                  setLastWorkspace(workspace.slug);
                  setWorkspaceOpen(false);
                }}
              >
                {workspace.name}
              </Link>
            ))}
          </div>
        </div>

        <label className="kh-ops-rail-search" htmlFor={jumpId}>
          <SearchGlyphIcon />
          <input
            id={jumpId}
            type="search"
            value={jump}
            onChange={(event) => setJump(event.target.value)}
            placeholder={t('jumpPlaceholder')}
            aria-label={t('jumpPlaceholder')}
          />
        </label>
        <div className={cn('kh-ops-jump-results', jump.trim() && 'open')}>
          {jumpHits.length === 0 ? (
            <p className="kh-ops-jump-empty">{t('jumpEmpty')}</p>
          ) : (
            jumpHits.map((hit) => (
              <Link
                key={`${hit.href}-${hit.label}`}
                href={hit.href}
                onClick={() => setJump('')}
              >
                {hit.label}
                <span className="kh-ops-jump-kind">{hit.section}</span>
              </Link>
            ))
          )}
        </div>

        <div className="kh-ops-nav-scroll">
          <nav className="kh-ops-nav" aria-label={t('menu')}>
            <div
              className="kh-ops-section-switcher"
              role="group"
              aria-label={t('sections')}
            >
              {visibleSections.map((group) => {
                const active = group.id === section;
                return (
                  <button
                    key={group.id}
                    type="button"
                    title={t(group.labelKey)}
                    aria-label={t(group.labelKey)}
                    aria-pressed={active}
                    className={active ? 'active' : undefined}
                    onClick={() => selectSection(group.id)}
                  >
                    <NavIcon name={group.icon} />
                    <span className="kh-ops-nav-label">{t(group.labelKey)}</span>
                  </button>
                );
              })}
            </div>

            {visibleSections.map((group) => (
              <section
                key={group.id}
                className={cn(
                  'kh-ops-nav-group',
                  group.id === section && 'section-active',
                )}
              >
                <div className="kh-ops-group-header">
                  <NavIcon name={group.icon} />
                  <span className="kh-ops-group-label">{t(group.labelKey)}</span>
                </div>
                <div className="kh-ops-nav-items">
                  {group.items
                    .filter((item) => !item.adminOnly || ctx.isAdmin)
                    .map((item) => {
                      const href = item.href(ctx);
                      const active = activeItem?.id === item.id;
                      return (
                        <Link
                          key={item.id}
                          href={href}
                          title={t(item.labelKey)}
                          className={active ? 'active' : undefined}
                          aria-current={active ? 'page' : undefined}
                        >
                          <NavIcon name={item.icon} />
                          <span className="kh-ops-nav-label">
                            {t(item.labelKey)}
                          </span>
                        </Link>
                      );
                    })}
                </div>
              </section>
            ))}
          </nav>
        </div>

        <div className="kh-ops-rail-foot" ref={userMenuRef}>
          <div
            className={cn('kh-ops-user-menu', userOpen && 'open')}
            role="menu"
            aria-label={t('accountMenu')}
          >
            <div className="kh-ops-account-head">
              <span className="kh-ops-avatar">{monogram}</span>
              <span>
                <strong>{session.user.displayName}</strong>
                <small>{session.user.email}</small>
              </span>
            </div>
            <div className="kh-ops-menu-section">
              <span className="kh-ops-menu-section-label">{t('account')}</span>
              <Link href="/account/profile" role="menuitem">
                {t('profile')}
              </Link>
              <Link href="/account/display" role="menuitem">
                {t('display')}
              </Link>
              <Link href="/account/identity" role="menuitem">
                {t('security')}
              </Link>
              <Link href="/account/notifications" role="menuitem">
                {t('notifications')}
              </Link>
              <Link href="/account/memberships" role="menuitem">
                {t('memberships')}
              </Link>
              <Link href="/account/ai-connections" role="menuitem">
                {t('aiConnections')}
              </Link>
              <Link
                href="/account/close"
                role="menuitem"
                className="close-account"
              >
                {t('closeAccount')}
              </Link>
            </div>
            <form className="kh-ops-menu-auth" action={logoutAction}>
              <button type="submit" role="menuitem" className="sign-out">
                {t('logOut')}
              </button>
            </form>
          </div>
          <button
            type="button"
            className="kh-ops-user-button"
            aria-haspopup="menu"
            aria-expanded={userOpen}
            onClick={() => setUserOpen((value) => !value)}
          >
            {session.user.avatarUrl ? (
              <span className="kh-ops-avatar">
                <UserAvatar
                  displayName={session.user.displayName}
                  fullName={session.user.fullName}
                  avatarUrl={session.user.avatarUrl}
                  size="sm"
                />
              </span>
            ) : (
              <span className="kh-ops-avatar">{monogram}</span>
            )}
            <span className="kh-ops-user-copy">
              <strong>{session.user.displayName}</strong>
              <small>{t('accountMenu')}</small>
            </span>
          </button>
          <span className="kh-ops-mode-copy">
            {compact ? t('compactNav') : t('expandedNav')}
          </span>
        </div>
      </aside>
    </>
  );
}

export function useRailChromeState() {
  const [compact, setCompact] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setCompact(readRailCompact());
  }, []);

  return { compact, setCompact, open, setOpen };
}
