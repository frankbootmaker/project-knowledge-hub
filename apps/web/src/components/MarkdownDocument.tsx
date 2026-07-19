'use client';

import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';

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
    <div style={{ display: 'grid', gridTemplateColumns: toc.length > 0 ? '220px 1fr' : '1fr', gap: '1.5rem' }}>
      {toc.length > 0 ? (
        <nav aria-label={t('tocLabel')} style={{ position: 'sticky', top: '1rem', alignSelf: 'start' }}>
          <h2 style={{ fontSize: '0.95rem', margin: '0 0 0.75rem' }}>{t('contents')}</h2>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.35rem' }}>
            {toc.map((item) => (
              <li key={item.id} style={{ paddingLeft: `${(item.depth - 1) * 0.75}rem` }}>
                <a href={`#${item.id}`} style={{ opacity: 0.85, fontSize: '0.9rem' }}>
                  {item.text}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
      <article
        ref={containerRef}
        className="knowledge-markdown"
        dangerouslySetInnerHTML={{ __html: html }}
        style={{
          lineHeight: 1.65,
          overflowWrap: 'anywhere',
        }}
      />
    </div>
  );
}
