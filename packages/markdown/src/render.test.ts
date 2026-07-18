import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './render.js';

describe('renderMarkdown', () => {
  it('renders headings, lists, and code blocks', async () => {
    const result = await renderMarkdown(`# Title

A paragraph.

- item one

\`\`\`ts
const x = 1;
\`\`\`
`);
    expect(result.html).toContain('<h1');
    expect(result.html).toContain('Title');
    expect(result.html).toContain('<li>');
    expect(result.html).toContain('<pre>');
    expect(result.toc.some((item) => item.text === 'Title')).toBe(true);
  });

  it('strips script tags from raw HTML in Markdown', async () => {
    const result = await renderMarkdown(
      '# Safe\n\n<script>alert("xss")</script>\n\n<img src=x onerror=alert(1)>\n',
    );
    expect(result.html.toLowerCase()).not.toContain('<script');
    expect(result.html.toLowerCase()).not.toContain('onerror');
    expect(result.html).toContain('Safe');
  });

  it('strips javascript: links', async () => {
    const result = await renderMarkdown('[click](javascript:alert(1))');
    expect(result.html.toLowerCase()).not.toContain('javascript:');
  });

  it('exposes mermaid blocks for client rendering', async () => {
    const result = await renderMarkdown(`\`\`\`mermaid
graph TD
  A-->B
\`\`\``);
    expect(result.html).toContain('class="mermaid"');
    expect(result.html).toContain('graph TD');
  });

  it('builds a table of contents from headings', async () => {
    const result = await renderMarkdown(`# One

## Two

### Three
`);
    expect(result.toc.map((item) => item.text)).toEqual(['One', 'Two', 'Three']);
    expect(result.toc.every((item) => item.id.length > 0)).toBe(true);
  });
});
