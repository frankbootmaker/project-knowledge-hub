/**
 * OpenAI-compatible chat/completions client using VISION_LLM_* env
 * (same provider as document-import vision OCR; text-only, no markitdown).
 */

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type VisionLlmConfig = {
  baseUrl: string;
  apiKey?: string;
  model: string;
  timeoutMs?: number;
};

export type ChatCompletionsResult = {
  content: string;
  model: string;
};

export function visionLlmConfigured(baseUrl: string | undefined | null): boolean {
  return Boolean(baseUrl?.trim());
}

export async function chatCompletions(
  config: VisionLlmConfig,
  messages: ChatMessage[],
): Promise<ChatCompletionsResult> {
  const baseUrl = config.baseUrl.replace(/\/$/, '');
  const apiKey = config.apiKey?.trim() || 'ollama';
  const model = config.model.trim() || 'gpt-4o-mini';
  const timeoutMs = config.timeoutMs ?? 120_000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.2,
      }),
      signal: controller.signal,
    });

    const rawBody = await response.text();
    if (!response.ok) {
      throw new Error(
        `Vision LLM chat/completions failed (${response.status}): ${rawBody.slice(0, 500)}`,
      );
    }

    let payload: {
      model?: string;
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    try {
      payload = JSON.parse(rawBody) as typeof payload;
    } catch {
      const snippet = rawBody.replace(/\s+/g, ' ').trim().slice(0, 200);
      throw new Error(
        `Vision LLM chat/completions returned non-JSON (check Admin → AI Providers base URL ends with /v1): ${snippet}`,
      );
    }
    const content = payload.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new Error('Vision LLM chat/completions response missing content');
    }

    return {
      content,
      model: payload.model?.trim() || model,
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Vision LLM chat/completions timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

const translationResultSchema = {
  parse(raw: unknown): {
    title: string;
    summary: string | null;
    contentMarkdown: string;
  } {
    if (!raw || typeof raw !== 'object') {
      throw new Error('Translation result must be a JSON object');
    }
    const obj = raw as Record<string, unknown>;
    const title = typeof obj.title === 'string' ? obj.title.trim() : '';
    if (!title || title.length > 300) {
      throw new Error('Translation result title is missing or too long');
    }
    let summary: string | null = null;
    if (obj.summary === null || obj.summary === undefined || obj.summary === '') {
      summary = null;
    } else if (typeof obj.summary === 'string') {
      summary = obj.summary.trim().slice(0, 1000);
    } else {
      throw new Error('Translation result summary must be a string or null');
    }
    const contentMarkdown =
      typeof obj.contentMarkdown === 'string' ? obj.contentMarkdown : '';
    if (!contentMarkdown) {
      throw new Error('Translation result contentMarkdown is missing');
    }
    if (contentMarkdown.length > 500_000) {
      throw new Error('Translation result contentMarkdown is too long');
    }
    return { title, summary, contentMarkdown };
  },
};

/** Strip Qwen/DeepSeek-style reasoning blocks before JSON extraction. */
export function stripModelReasoning(content: string): string {
  return content
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    .trim();
}

/**
 * Some small models put literal `\n` sequences into the JSON string value
 * (or return a single-line body that only uses escaped newlines).
 */
export function unescapeLiteralNewlines(text: string): string {
  const realNl = (text.match(/\n/g) ?? []).length;
  const literalNl = (text.match(/\\n/g) ?? []).length;
  if (literalNl >= 2 && literalNl > realNl) {
    return text.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
  }
  return text;
}

/**
 * Small models often drop ATX heading markers while translating the heading text.
 * If the source opens with `#…` and the translation's first line does not, restore
 * the same heading level.
 */
export function restoreStrippedMarkdownHeading(
  sourceMarkdown: string,
  translatedMarkdown: string,
): string {
  const srcLines = sourceMarkdown.replace(/\r\n/g, '\n').split('\n');
  const dstLines = translatedMarkdown.replace(/\r\n/g, '\n').split('\n');
  const srcFirstIdx = srcLines.findIndex((line) => line.trim().length > 0);
  const dstFirstIdx = dstLines.findIndex((line) => line.trim().length > 0);
  if (srcFirstIdx < 0 || dstFirstIdx < 0) {
    return translatedMarkdown;
  }

  const srcFirst = srcLines[srcFirstIdx]!;
  const dstFirst = dstLines[dstFirstIdx]!;
  const heading = srcFirst.match(/^(#{1,6})\s+\S/);
  if (!heading) {
    return translatedMarkdown;
  }
  if (/^#{1,6}\s+\S/.test(dstFirst)) {
    return translatedMarkdown;
  }

  dstLines[dstFirstIdx] = `${heading[1]} ${dstFirst.trim()}`;
  return dstLines.join('\n');
}

export function normalizeTranslatedMarkdown(
  sourceMarkdown: string,
  translatedMarkdown: string,
): string {
  const unescaped = unescapeLiteralNewlines(translatedMarkdown);
  return restoreStrippedMarkdownHeading(sourceMarkdown, unescaped);
}

/** Extract JSON object from model output (raw or fenced). */
export function parseTranslationJson(content: string): {
  title: string;
  summary: string | null;
  contentMarkdown: string;
} {
  const trimmed = stripModelReasoning(content);
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? trimmed).trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start < 0 || end <= start) {
      throw new Error('Translation model output is not valid JSON');
    }
    parsed = JSON.parse(candidate.slice(start, end + 1));
  }

  const fields = translationResultSchema.parse(parsed);
  return {
    ...fields,
    title: unescapeLiteralNewlines(fields.title).trim(),
    summary:
      fields.summary == null
        ? null
        : unescapeLiteralNewlines(fields.summary).trim().slice(0, 1000) || null,
    contentMarkdown: unescapeLiteralNewlines(fields.contentMarkdown),
  };
}

export async function translateRecordFields(input: {
  baseUrl: string;
  apiKey?: string;
  model: string;
  timeoutMs?: number;
  targetLanguage: string;
  sourceLanguage: string | null;
  title: string;
  summary: string | null;
  contentMarkdown: string;
}): Promise<{
  title: string;
  summary: string | null;
  contentMarkdown: string;
  model: string;
}> {
  const sourceLang = input.sourceLanguage?.trim() || 'undetermined';
  const system = [
    'You are a professional translator for a knowledge-base CMS.',
    `Translate the knowledge record from ${sourceLang} into ${input.targetLanguage}.`,
    'contentMarkdown MUST remain valid Markdown with the SAME structure as the source:',
    'keep ATX headings (including the leading # characters), lists, tables, code fences, and links.',
    'Example: source "# Bridge\\n\\nSettings." → contentMarkdown "# Híd\\n\\nBeállítások."',
    'Never flatten headings into plain paragraphs. Never omit the # markers.',
    'In JSON string values, use real newline escapes (\\n), not the two characters backslash and n as body text.',
    'Do NOT change media embed URLs of the form ![alt](/api/v1/media/...). You may translate alt text.',
    'Do NOT invent facts; translate faithfully.',
    'Respond with ONLY a JSON object (no markdown outside JSON, no commentary) with keys:',
    'title (string), summary (string or null), contentMarkdown (string).',
  ].join(' ');

  const userPayload = JSON.stringify({
    title: input.title,
    summary: input.summary,
    contentMarkdown: input.contentMarkdown,
  });

  const { content, model } = await chatCompletions(
    {
      baseUrl: input.baseUrl,
      apiKey: input.apiKey,
      model: input.model,
      timeoutMs: input.timeoutMs,
    },
    [
      { role: 'system', content: system },
      { role: 'user', content: userPayload },
    ],
  );

  const fields = parseTranslationJson(content);
  return {
    title: fields.title,
    summary: fields.summary,
    contentMarkdown: normalizeTranslatedMarkdown(
      input.contentMarkdown,
      fields.contentMarkdown,
    ),
    model,
  };
}
