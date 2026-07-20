import { describe, expect, it } from 'vitest';
import {
  createConversationImportInputSchema,
  createDraftFromImportInputSchema,
  normalizeRawContent,
  resolveDraftMarkdown,
} from './schemas.js';

describe('conversation-import schemas', () => {
  it('parses create import input', () => {
    const parsed = createConversationImportInputSchema.parse({
      workspaceId: '11111111-1111-4111-8111-111111111111',
      title: 'Chat about deploy',
      rawContent: 'Hello\n\nWorld',
      contentFormat: 'plain_text',
    });
    expect(parsed.contentFormat).toBe('plain_text');
    expect(parsed.rawContent).toContain('World');
  });

  it('defaults draft record type to conversation-summary', () => {
    const parsed = createDraftFromImportInputSchema.parse({
      title: 'Summary',
    });
    expect(parsed.recordType).toBe('conversation-summary');
  });

  it('normalizes and resolves draft markdown', () => {
    expect(normalizeRawContent('  hi\r\nthere  \n')).toBe('hi\nthere');
    expect(
      resolveDraftMarkdown({
        rawContent: 'full body',
        contentFormat: 'markdown',
        contentMarkdown: '  excerpt only  ',
      }),
    ).toBe('excerpt only');
    expect(
      resolveDraftMarkdown({
        rawContent: 'full body',
        contentFormat: 'plain_text',
      }),
    ).toBe('full body');
  });
});
