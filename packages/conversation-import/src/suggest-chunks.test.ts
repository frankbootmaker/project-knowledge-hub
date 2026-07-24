import { describe, expect, it } from 'vitest';
import { suggestDraftChunks } from './suggest-chunks.js';

describe('suggestDraftChunks', () => {
  it('pairs structured user/assistant turns', () => {
    const raw = JSON.stringify({
      title: 'Ops',
      messages: [
        { role: 'user', content: 'Is backup stale?' },
        { role: 'assistant', content: 'Check Monitoring.' },
        { role: 'user', content: 'Thanks' },
        { role: 'assistant', content: 'Anytime' },
      ],
    });
    const chunks = suggestDraftChunks({
      title: 'Ops',
      rawContent: raw,
      contentFormat: 'generic_json',
    });
    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.contentMarkdown).toContain('Is backup stale?');
    expect(chunks[0]?.contentMarkdown).toContain('Check Monitoring.');
  });

  it('splits markdown role headings', () => {
    const markdown = [
      '## User',
      '',
      'Hello',
      '',
      '## Assistant',
      '',
      'Hi',
      '',
      '## User',
      '',
      'Bye',
      '',
      '## Assistant',
      '',
      'Later',
    ].join('\n');
    const chunks = suggestDraftChunks({
      title: 'Chat',
      rawContent: markdown,
      contentFormat: 'markdown',
      draftMarkdown: markdown,
    });
    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });
});
