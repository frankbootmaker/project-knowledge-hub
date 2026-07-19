'use client';

import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '../lib/cn';

type TocItem = {
  id: string;
  text: string;
  depth: number;
};

export function MarkdownDocument({
  html,
  toc,
}: {
  html: string;
  toc: TocItem[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const t = useTranslations('records');

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
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'neutral',
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

  return (
    <div
      className={cn(
        'grid gap-6',
        toc.length > 0 ? 'lg:grid-cols-[220px_1fr]' : 'grid-cols-1',
      )}
    >
      {toc.length > 0 ? (
        <nav
          aria-label={t('tocLabel')}
          className="sticky top-4 self-start"
        >
          <h2 className="mt-0 mb-3 text-sm font-semibold text-ink">{t('contents')}</h2>
          <ul className="m-0 grid list-none gap-1.5 p-0">
            {toc.map((item) => (
              <li
                key={item.id}
                style={{ paddingLeft: `${(item.depth - 1) * 0.75}rem` }}
              >
                <a
                  href={`#${item.id}`}
                  className="text-sm text-ink-muted no-underline hover:text-brand"
                >
                  {item.text}
                </a>
              </li>
            ))}
          </ul>
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
