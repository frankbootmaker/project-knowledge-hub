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

  it('keeps relative hub media image urls', async () => {
    const result = await renderMarkdown(
      '![diagram](/api/v1/media/00000000-0000-4000-8000-000000000001)',
    );
    expect(result.html).toContain('src="/api/v1/media/00000000-0000-4000-8000-000000000001"');
  });

  it('strips data: image urls', async () => {
    const result = await renderMarkdown('![x](data:image/png;base64,aaaa)');
    expect(result.html.toLowerCase()).not.toContain('data:image');
  });
});
