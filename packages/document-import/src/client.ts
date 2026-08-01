import type {
  DocumentImportOcrEngine,
  DocumentImportOcrLang,
} from './types.js';

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
  ocrEngine?: DocumentImportOcrEngine;
  ocrLang?: DocumentImportOcrLang;
};

export type MarkItDownHealth = {
  ok: boolean;
  vision: boolean;
  tesseract: boolean;
  engines: DocumentImportOcrEngine[];
  tesseractLangs?: DocumentImportOcrLang[];
};

export async function convertWithMarkItDown(input: {
  baseUrl: string;
  timeoutMs: number;
  filename: string;
  contentType: string;
  buffer: Buffer;
  lane: 'document' | 'image';
  ocrEngine?: DocumentImportOcrEngine;
  ocrLang?: DocumentImportOcrLang;
  /** Optional per-request vision LLM overrides (Admin AI Providers). */
  visionBaseUrl?: string;
  visionApiKey?: string;
  visionModel?: string;
}): Promise<MarkItDownConvertResult> {
  const base = input.baseUrl.replace(/\/+$/, '');
  const form = new FormData();
  form.set(
    'file',
    new Blob([new Uint8Array(input.buffer)], { type: input.contentType }),
    input.filename,
  );
  form.set('lane', input.lane);
  form.set('ocrEngine', input.ocrEngine ?? 'none');
  if (input.ocrLang) form.set('ocrLang', input.ocrLang);
  if (input.visionBaseUrl?.trim()) {
    form.set('visionBaseUrl', input.visionBaseUrl.trim());
  }
  if (input.visionApiKey?.trim()) {
    form.set('visionApiKey', input.visionApiKey.trim());
  }
  if (input.visionModel?.trim()) {
    form.set('visionModel', input.visionModel.trim());
  }

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
      ocrEngine?: DocumentImportOcrEngine;
      ocrLang?: DocumentImportOcrLang;
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
      ocrEngine: body.ocrEngine,
      ocrLang: body.ocrLang,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function markitdownHealth(
  baseUrl: string,
): Promise<MarkItDownHealth> {
  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      return { ok: false, vision: false, tesseract: false, engines: ['none'] };
    }
    const body = (await response.json().catch(() => ({}))) as {
      vision?: boolean;
      tesseract?: boolean;
      engines?: string[];
    };
    const engines = (Array.isArray(body.engines) ? body.engines : ['none']).filter(
      (value): value is DocumentImportOcrEngine =>
        value === 'none' || value === 'vision' || value === 'tesseract',
    );
    return {
      ok: true,
      vision: Boolean(body.vision),
      tesseract: Boolean(body.tesseract),
      engines: engines.length > 0 ? engines : ['none'],
    };
  } catch {
    return { ok: false, vision: false, tesseract: false, engines: ['none'] };
  }
}
