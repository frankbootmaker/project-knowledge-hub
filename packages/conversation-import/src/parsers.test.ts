import { describe, expect, it } from 'vitest';
import {
  parseChatgptExport,
  parseGenericJsonExport,
  parseOpenWebuiExport,
} from './parsers.js';

describe('conversation import parsers', () => {
  it('parses ChatGPT mapping export', () => {
    const raw = JSON.stringify({
      title: 'Deploy plan',
      mapping: {
        root: {
          id: 'root',
          parent: null,
          children: ['m1'],
          message: null,
        },
        m1: {
          id: 'm1',
          parent: 'root',
          children: ['m2'],
          message: {
            author: { role: 'user' },
            content: { parts: ['Ship M9 importers'] },
          },
        },
        m2: {
          id: 'm2',
          parent: 'm1',
          children: [],
          message: {
            author: { role: 'assistant' },
            content: { parts: ['Yes, ChatGPT and Open WebUI next.'] },
          },
        },
      },
    });
    const parsed = parseChatgptExport(raw);
    expect(parsed.title).toBe('Deploy plan');
    expect(parsed.turns).toHaveLength(2);
    expect(parsed.markdown).toContain('# Deploy plan');
    expect(parsed.markdown).toContain('## User');
    expect(parsed.markdown).toContain('Ship M9 importers');
    expect(parsed.markdown).toContain('## Assistant');
  });

  it('parses Open WebUI messages array', () => {
    const raw = JSON.stringify({
      title: 'Ops chat',
      messages: [
        { role: 'user', content: 'Is backup stale?' },
        { role: 'assistant', content: 'Check Monitoring.' },
      ],
    });
    const parsed = parseOpenWebuiExport(raw);
    expect(parsed.title).toBe('Ops chat');
    expect(parsed.turns).toHaveLength(2);
    expect(parsed.markdown).toContain('Is backup stale?');
  });

  it('parses generic JSON turns', () => {
    const raw = JSON.stringify({
      title: 'Generic',
      turns: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
      ],
    });
    const parsed = parseGenericJsonExport(raw);
    expect(parsed.markdown).toContain('Hello');
    expect(parsed.markdown).toContain('Hi there');
  });

  it('rejects empty ChatGPT export', () => {
    expect(() => parseChatgptExport('{"title":"x","mapping":{}}')).toThrow(
      /no user\/assistant/i,
    );
  });
});
