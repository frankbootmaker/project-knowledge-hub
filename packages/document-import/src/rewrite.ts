export type AttachmentImage = {
  filename: string;
  contentType: string;
};

/**
 * Rewrite `attachment:N` placeholders (and bare filenames from the sidecar)
 * to hub media embed URLs `/api/v1/media/:id`.
 */
/** Postgres text rejects U+0000; PDF extractors often emit it for soft hyphens. */
export function sanitizePgText(value: string): string {
  // eslint-disable-next-line no-control-regex -- strip NUL for Postgres
  return value.replace(/\u0000/g, '');
}

export function rewriteAttachmentPlaceholders(
  markdown: string,
  mediaByIndex: Map<number, { id: string; filename?: string | null }>,
): string {
  let out = markdown;
  for (const [index, media] of mediaByIndex) {
    const url = `/api/v1/media/${media.id}`;
    out = out.replaceAll(`](attachment:${index})`, `](${url})`);
    out = out.replaceAll(`](attachment://${index})`, `](${url})`);
    if (media.filename) {
      // Sidecar may leave raw filenames in some converters.
      out = out.replaceAll(`](${media.filename})`, `](${url})`);
    }
  }
  return out;
}

/** Prefer sidecar titleHint, else filename stem. */
export function titleFromImport(input: {
  titleHint?: string | null;
  originalFilename: string;
}): string {
  const hint = input.titleHint?.trim();
  if (hint) return hint.slice(0, 200);
  const base = input.originalFilename.replace(/\.[^.]+$/, '').trim();
  return (base || 'Imported document').slice(0, 200);
}
