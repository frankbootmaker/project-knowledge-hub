import { AppError } from './index.js';

/**
 * Optimistic check for update_knowledge_record and finalize_record_content_upload.
 * A mismatch is a 409 conflict and the caller must write nothing.
 */
export function assertKnowledgeRecordConcurrency(input: {
  contentSha256: string;
  currentVersionNumber: number;
  expectSha256?: string;
  expectedVersion?: number;
}): void {
  if (
    input.expectSha256 !== undefined &&
    input.expectSha256.toLowerCase() !== input.contentSha256.toLowerCase()
  ) {
    throw new AppError({
      code: 'CONTENT_CHANGED',
      message: '409 conflict: record content does not match expectSha256. Nothing was written.',
      statusCode: 409,
      details: {
        errorType: 'conflict',
        contentSha256: input.contentSha256,
        currentVersionNumber: input.currentVersionNumber,
      },
    });
  }
  if (input.expectedVersion !== undefined && input.expectedVersion !== input.currentVersionNumber) {
    throw new AppError({
      code: 'VERSION_CONFLICT',
      message: `409 conflict: expectedVersion ${input.expectedVersion} does not match current version ${input.currentVersionNumber}. Nothing was written.`,
      statusCode: 409,
      details: {
        errorType: 'conflict',
        currentVersionNumber: input.currentVersionNumber,
      },
    });
  }
}
