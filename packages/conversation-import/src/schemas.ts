import { z } from 'zod';
import { recordTypeSchema } from '@project-knowledge-hub/domain';
import {
  isStructuredContentFormat,
  parseStructuredConversation,
} from './parsers.js';

export const CONVERSATION_CONTENT_FORMATS = [
  'plain_text',
  'markdown',
  'chatgpt_export',
  'open_webui',
  'generic_json',
] as const;
export type ConversationContentFormat = (typeof CONVERSATION_CONTENT_FORMATS)[number];

export const conversationContentFormatSchema = z.enum(CONVERSATION_CONTENT_FORMATS);

const RAW_CONTENT_MAX = 500_000;

export const createConversationImportInputSchema = z.object({
  workspaceId: z.string().uuid(),
  title: z.string().min(1).max(300),
  contentFormat: conversationContentFormatSchema.default('markdown'),
  rawContent: z.string().min(1).max(RAW_CONTENT_MAX),
  projectId: z.string().uuid().nullable().optional(),
  systemId: z.string().uuid().nullable().optional(),
  sourceProvider: z.string().max(160).nullable().optional(),
  generatedByModel: z.string().max(160).nullable().optional(),
});

export type CreateConversationImportInput = z.infer<
  typeof createConversationImportInputSchema
>;

export const createDraftFromImportInputSchema = z.object({
  title: z.string().min(1).max(300),
  recordType: recordTypeSchema.default('conversation-summary'),
  /** When omitted, uses the full raw import body (parsed to Markdown for structured formats). */
  contentMarkdown: z.string().min(1).max(RAW_CONTENT_MAX).optional(),
  summary: z.string().max(1000).optional(),
  slug: z.string().min(1).max(96).optional(),
  tags: z.array(z.string().min(1).max(64)).max(30).optional(),
  language: z.string().min(2).max(16).optional(),
  excerptNote: z.string().max(500).nullable().optional(),
  /** Override import defaults when creating the draft. */
  projectId: z.string().uuid().nullable().optional(),
  systemId: z.string().uuid().nullable().optional(),
  /** Required when draft body still contains high-severity secret warnings. */
  acknowledgeSecrets: z.boolean().optional(),
});

export type CreateDraftFromImportInput = z.infer<typeof createDraftFromImportInputSchema>;

/** Normalize pasted content: trim ends, collapse excessive trailing newlines. */
export function normalizeRawContent(raw: string): string {
  return raw.replace(/\r\n/g, '\n').replace(/\s+$/u, '').trimStart();
}

/**
 * Validate structured formats at create time; no-op for plain/markdown.
 * Throws Error with a user-facing message on failure.
 */
export function assertImportContentParsable(input: {
  rawContent: string;
  contentFormat: ConversationContentFormat;
}): void {
  if (!isStructuredContentFormat(input.contentFormat)) return;
  parseStructuredConversation(input.contentFormat, input.rawContent);
}

/**
 * Resolve draft Markdown body from an import.
 * Structured JSON formats are converted to role-headed Markdown.
 */
export function resolveDraftMarkdown(input: {
  rawContent: string;
  contentFormat: ConversationContentFormat;
  contentMarkdown?: string;
}): string {
  if (input.contentMarkdown !== undefined) {
    const excerpt = normalizeRawContent(input.contentMarkdown);
    if (!excerpt) {
      throw new Error('Draft content is empty');
    }
    return excerpt;
  }
  const full = normalizeRawContent(input.rawContent);
  if (!full) {
    throw new Error('Import raw content is empty');
  }
  if (isStructuredContentFormat(input.contentFormat)) {
    return parseStructuredConversation(input.contentFormat, full).markdown;
  }
  return full;
}

export function defaultSourceProviderForFormat(
  format: ConversationContentFormat,
): string | null {
  switch (format) {
    case 'chatgpt_export':
      return 'ChatGPT';
    case 'open_webui':
      return 'Open WebUI';
    case 'generic_json':
      return 'JSON';
    default:
      return null;
  }
}
