export const DOCUMENT_IMPORT_PROGRESS_STAGES = [
  'queued',
  'reading',
  'converting',
  'ocr',
  'storing_media',
  'finalizing',
] as const;

export type DocumentImportProgressStage =
  (typeof DOCUMENT_IMPORT_PROGRESS_STAGES)[number];

/** Keep Details logs bounded for large/noisy converts. */
export const PROGRESS_LOG_MAX_CHARS = 48_000;

/**
 * Append a timestamped line to the import progress log, truncating from the
 * front when the cap is exceeded.
 */
export function appendProgressLog(
  existing: string | null | undefined,
  line: string,
  now: Date = new Date(),
): string {
  const trimmed = line.replace(/\s+/g, ' ').trim();
  if (!trimmed) {
    return existing?.trim() ?? '';
  }
  const entry = `[${now.toISOString()}] ${trimmed}`;
  const base = existing?.trimEnd() ?? '';
  const next = base ? `${base}\n${entry}` : entry;
  if (next.length <= PROGRESS_LOG_MAX_CHARS) {
    return next;
  }
  const sliced = next.slice(next.length - PROGRESS_LOG_MAX_CHARS);
  const newline = sliced.indexOf('\n');
  return newline >= 0 ? sliced.slice(newline + 1) : sliced;
}
