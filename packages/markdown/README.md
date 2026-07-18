# @project-knowledge-hub/markdown

Safe Markdown parsing, sanitization, rendering helpers, and Mermaid-ready HTML.

## API

```ts
import { renderMarkdown } from '@project-knowledge-hub/markdown';

const { html, toc } = await renderMarkdown(source);
```

* GFM (tables, task lists, strikethrough)
* Heading slugs and table of contents
* Syntax highlighting via `rehype-highlight`
* HTML sanitized with an allowlist (no scripts / event handlers)
* Mermaid fenced blocks become `<pre class="mermaid">` for client-side Mermaid

## Milestone status

Implemented for Milestone 3 (knowledge records).
