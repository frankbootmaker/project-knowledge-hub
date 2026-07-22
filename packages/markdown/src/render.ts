import { toString } from 'hast-util-to-string';
import rehypeHighlight from 'rehype-highlight';
import rehypeSanitize from 'rehype-sanitize';
import rehypeSlug from 'rehype-slug';
import rehypeStringify from 'rehype-stringify';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';
import type { Element, Root } from 'hast';
import { knowledgeSanitizeSchema } from './sanitize-schema.js';

export type TocItem = {
  id: string;
  text: string;
  depth: number;
};

export type RenderedMarkdown = {
  html: string;
  toc: TocItem[];
};

/**
 * Mark fenced mermaid blocks so they are not highlighted as code,
 * and expose them as `<pre class="mermaid">` for client-side Mermaid.
 */
function rehypeMermaidBlocks(): (tree: Root) => void {
  return (tree) => {
    visit(tree, 'element', (node: Element, index, parent) => {
      if (node.tagName !== 'pre' || !parent || typeof index !== 'number') {
        return;
      }
      const code = node.children.find(
        (child): child is Element => child.type === 'element' && child.tagName === 'code',
      );
      if (!code) {
        return;
      }
      const className = code.properties?.className;
      const classes = Array.isArray(className)
        ? className.map(String)
        : typeof className === 'string'
          ? [className]
          : [];
      const isMermaid = classes.some(
        (value) => value === 'language-mermaid' || value === 'mermaid',
      );
      if (!isMermaid) {
        return;
      }
      parent.children[index] = {
        type: 'element',
        tagName: 'pre',
        properties: { className: ['mermaid'] },
        children: [
          {
            type: 'text',
            value: toString(code),
          },
        ],
      };
    });
  };
}

function collectToc(tree: Root): TocItem[] {
  const toc: TocItem[] = [];
  visit(tree, 'element', (node: Element) => {
    if (!/^h[1-6]$/.test(node.tagName)) {
      return;
    }
    const id = typeof node.properties?.id === 'string' ? node.properties.id : '';
    if (!id) {
      return;
    }
    toc.push({
      id,
      text: toString(node),
      depth: Number(node.tagName.slice(1)),
    });
  });
  return toc;
}

export async function renderMarkdown(markdown: string): Promise<RenderedMarkdown> {
  let toc: TocItem[] = [];

  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: false })
    .use(rehypeSlug)
    .use(rehypeMermaidBlocks)
    .use(rehypeHighlight, { detect: false, ignoreMissing: true })
    .use(rehypeSanitize, knowledgeSanitizeSchema)
    // After sanitize: ids may be prefixed (e.g. user-content-); TOC must match HTML.
    .use(() => (tree: Root) => {
      toc = collectToc(tree);
    })
    .use(rehypeStringify)
    .process(markdown);

  return {
    html: String(file),
    toc,
  };
}
