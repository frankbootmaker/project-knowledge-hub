import { z } from 'zod';
import { RECORD_TYPES } from '@project-knowledge-hub/domain';

export const DOCUMENT_IMPORT_LANES = ['document', 'image'] as const;
export type DocumentImportLane = (typeof DOCUMENT_IMPORT_LANES)[number];

export const DOCUMENT_IMPORT_STATUSES = [
  'pending',
  'converting',
  'ready',
  'failed',
] as const;
export type DocumentImportStatus = (typeof DOCUMENT_IMPORT_STATUSES)[number];

/** OCR path for MarkItDown convert (per-import or DOCUMENT_IMPORT_OCR_ENGINE default). */
export const DOCUMENT_IMPORT_OCR_ENGINES = ['none', 'vision', 'tesseract'] as const;
export type DocumentImportOcrEngine =
  (typeof DOCUMENT_IMPORT_OCR_ENGINES)[number];

export const documentImportLaneSchema = z.enum(DOCUMENT_IMPORT_LANES);
export const documentImportStatusSchema = z.enum(DOCUMENT_IMPORT_STATUSES);
export const documentImportOcrEngineSchema = z.enum(DOCUMENT_IMPORT_OCR_ENGINES);

/** Allowed MIME types for the documents lane. */
export const DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/msword',
  'application/vnd.ms-powerpoint',
  'application/vnd.ms-excel',
  'text/html',
  'text/markdown',
  'text/plain',
  'application/octet-stream',
] as const;

/** Allowed MIME types for the images lane. */
export const IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
] as const;

const DOCUMENT_EXTENSIONS = [
  '.pdf',
  '.docx',
  '.pptx',
  '.xlsx',
  '.doc',
  '.ppt',
  '.xls',
  '.html',
  '.htm',
  '.md',
  '.markdown',
  '.txt',
] as const;

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif'] as const;

export function extensionOf(filename: string): string {
  const i = filename.lastIndexOf('.');
  return i >= 0 ? filename.slice(i).toLowerCase() : '';
}

export function isAllowedUpload(input: {
  lane: DocumentImportLane;
  filename: string;
  contentType: string;
}): boolean {
  const ext = extensionOf(input.filename);
  const ct = input.contentType.toLowerCase().split(';')[0]?.trim() ?? '';
  if (input.lane === 'image') {
    return (
      (IMAGE_MIME_TYPES as readonly string[]).includes(ct) ||
      (IMAGE_EXTENSIONS as readonly string[]).includes(ext)
    );
  }
  if ((IMAGE_MIME_TYPES as readonly string[]).includes(ct)) {
    return false;
  }
  return (
    (DOCUMENT_MIME_TYPES as readonly string[]).includes(ct) ||
    (DOCUMENT_EXTENSIONS as readonly string[]).includes(ext)
  );
}

export const createDraftFromDocumentImportInputSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  recordType: z.enum(RECORD_TYPES).optional(),
  excerptNote: z.string().trim().max(2000).optional(),
  acknowledgeSecrets: z.boolean().optional(),
  contentMarkdown: z.string().max(500_000).optional(),
});

export type CreateDraftFromDocumentImportInput = z.infer<
  typeof createDraftFromDocumentImportInputSchema
>;
