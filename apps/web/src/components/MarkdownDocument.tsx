'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '../lib/cn';

type TocItem = {
  id: string;
  text: string;
  depth: number;
};

type TocBranch = {
  item: TocItem;
  children: TocItem[];
};

function buildTocBranches(toc: TocItem[]): TocBranch[] {
  if (toc.length === 0) {
    return [];
  }
  const topDepth = Math.min(...toc.map((item) => item.depth), 2);
  const branches: TocBranch[] = [];
  let current: TocBranch | null = null;

  for (const item of toc) {
    if (item.depth <= topDepth) {
      current = { item, children: [] };
      branches.push(current);
      continue;
    }
    if (current) {
      current.children.push(item);
    } else {
      branches.push({ item, children: [] });
    }
  }

  return branches;
}

export function MarkdownDocument({
  html,
  toc,
}: {
  html: string;
  toc: TocItem[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const t = useTranslations('records');
  const [tocOpen, setTocOpen] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());

  const branches = useMemo(() => buildTocBranches(toc), [toc]);

  useEffect(() => {
    let cancelled = false;

    async function runMermaid() {
      const root = containerRef.current;
      if (!root) {
        return;
      }
      const blocks = root.querySelectorAll('pre.mermaid');
      if (blocks.length === 0) {
        return;
      }
      const mermaid = (await import('mermaid')).default;
      const dark = document.documentElement.classList.contains('dark');
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: dark ? 'dark' : 'neutral',
      });
      if (!cancelled) {
        await mermaid.run({
          nodes: Array.from(blocks) as HTMLElement[],
        });
      }
    }

    void runMermaid();
    return () => {
      cancelled = true;
    };
  }, [html]);

  function scrollToHeading(id: string) {
    const root = containerRef.current;
    const target =
      root?.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`) ??
      document.getElementById(id);
    if (!target) {
      return;
    }

    const headerOffset = 88;
    let scroller: HTMLElement | null = target.parentElement;
    while (scroller && scroller !== document.body) {
      const style = window.getComputedStyle(scroller);
      const overflowY = style.overflowY;
      if (
        (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') &&
        scroller.scrollHeight > scroller.clientHeight + 1
      ) {
        const top =
          target.getBoundingClientRect().top -
          scroller.getBoundingClientRect().top +
          scroller.scrollTop -
          headerOffset;
        scroller.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
        return;
      }
      scroller = scroller.parentElement;
    }

    const top = target.getBoundingClientRect().top + window.scrollY - headerOffset;
    window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }

  function onTocClick(item: TocItem, hasChildren: boolean) {
    scrollToHeading(item.id);
    if (!hasChildren) {
      return;
    }
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(item.id)) {
        next.delete(item.id);
      } else {
        next.add(item.id);
      }
      return next;
    });
  }

  return (
    <div
      className={cn(
        'grid gap-6',
        toc.length > 0 && tocOpen ? 'lg:grid-cols-[220px_1fr]' : 'grid-cols-1',
      )}
    >
      {toc.length > 0 ? (
        <nav
          aria-label={t('tocLabel')}
          className={cn(tocOpen ? 'sticky top-4 self-start' : null)}
        >
          <button
            type="button"
            className="kh-btn kh-btn-secondary mb-3 inline-flex items-center gap-2 text-sm"
            aria-expanded={tocOpen}
            onClick={() => setTocOpen((open) => !open)}
          >
            {tocOpen ? t('tocCollapse') : t('tocExpand')}
          </button>
          {tocOpen ? (
            <>
              <h2 className="mt-0 mb-3 text-sm font-semibold text-ink">{t('contents')}</h2>
              <ul className="m-0 grid list-none gap-1.5 p-0">
                {branches.map((branch) => {
                  const expanded = expandedIds.has(branch.item.id);
                  const hasChildren = branch.children.length > 0;
                  return (
                    <li key={branch.item.id} className="grid gap-1">
                      <button
                        type="button"
                        className="text-left text-sm text-ink-muted no-underline hover:text-brand"
                        style={{
                          paddingLeft: `${Math.max(0, branch.item.depth - 1) * 0.75}rem`,
                        }}
                        onClick={() => onTocClick(branch.item, hasChildren)}
                      >
                        {hasChildren ? (expanded ? '▾ ' : '▸ ') : null}
                        {branch.item.text}
                      </button>
                      {hasChildren && expanded ? (
                        <ul className="m-0 grid list-none gap-1 p-0">
                          {branch.children.map((child) => (
                            <li key={child.id}>
                              <button
                                type="button"
                                className="text-left text-sm text-ink-muted no-underline hover:text-brand"
                                style={{
                                  paddingLeft: `${Math.max(0, child.depth - 1) * 0.75}rem`,
                                }}
                                onClick={() => scrollToHeading(child.id)}
                              >
                                {child.text}
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </>
          ) : null}
        </nav>
      ) : null}
      <article
        ref={containerRef}
        className="knowledge-markdown leading-relaxed break-words"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
