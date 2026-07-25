export type MarkItDownImage = {
  filename: string;
  contentType: string;
  dataBase64: string;
};

export type MarkItDownConvertResult = {
  markdown: string;
  titleHint?: string;
  images: MarkItDownImage[];
  warnings: string[];
  visionUsed?: boolean;
};

export async function convertWithMarkItDown(input: {
  baseUrl: string;
  timeoutMs: number;
  filename: string;
  contentType: string;
  buffer: Buffer;
  lane: 'document' | 'image';
}): Promise<MarkItDownConvertResult> {
  const base = input.baseUrl.replace(/\/+$/, '');
  const form = new FormData();
  form.set(
    'file',
    new Blob([new Uint8Array(input.buffer)], { type: input.contentType }),
    input.filename,
  );
  form.set('lane', input.lane);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const response = await fetch(`${base}/convert`, {
      method: 'POST',
      body: form,
      signal: controller.signal,
    });
    const body = (await response.json().catch(() => ({}))) as {
      detail?: string;
      markdown?: string;
      titleHint?: string;
      images?: MarkItDownImage[];
      warnings?: string[];
      visionUsed?: boolean;
    };
    if (!response.ok) {
      throw new Error(
        body.detail ?? `MarkItDown convert failed (HTTP ${response.status})`,
      );
    }
    if (!body.markdown || typeof body.markdown !== 'string') {
      throw new Error('MarkItDown returned no markdown');
    }
    return {
      markdown: body.markdown,
      titleHint: body.titleHint,
      images: Array.isArray(body.images) ? body.images : [],
      warnings: Array.isArray(body.warnings) ? body.warnings : [],
      visionUsed: body.visionUsed,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function markitdownHealth(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
