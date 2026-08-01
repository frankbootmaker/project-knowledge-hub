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

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Vision LLM chat/completions failed (${response.status}): ${body.slice(0, 500)}`,
      );
    }

    const payload = (await response.json()) as {
      model?: string;
      choices?: Array<{ message?: { content?: string | null } }>;
    };
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

/** Extract JSON object from model output (raw or fenced). */
export function parseTranslationJson(content: string): {
  title: string;
  summary: string | null;
  contentMarkdown: string;
} {
  const trimmed = content.trim();
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

  return translationResultSchema.parse(parsed);
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
    'Preserve Markdown structure, headings, lists, tables, code fences, and links.',
    'Do NOT change media embed URLs of the form ![alt](/api/v1/media/...). You may translate alt text.',
    'Do NOT invent facts; translate faithfully.',
    'Respond with ONLY a JSON object (no markdown outside JSON) with keys:',
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
  return { ...fields, model };
}
