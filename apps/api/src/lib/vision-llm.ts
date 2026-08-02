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

export type ChatCompletionsOptions = {
  /**
   * Ask the provider for a JSON object (`response_format`).
   * On Ollama + Qwen3 this also helps skip long “thinking” for structured tasks.
   */
  jsonObject?: boolean;
  /**
   * Disable chain-of-thought / reasoning when the provider supports it.
   * Defaults to true — translation/OCR do not benefit from long think traces.
   */
  disableThinking?: boolean;
};

export function visionLlmConfigured(baseUrl: string | undefined | null): boolean {
  return Boolean(baseUrl?.trim());
}

export type TranslationProgressStage =
  | 'preparing'
  | 'calling_model'
  | 'retrying'
  | 'saving';

export type TranslationProgressEvent =
  | {
      type: 'stage';
      stage: TranslationProgressStage;
      model?: string;
      message?: string;
    }
  | { type: 'llm_delta'; text: string };

function buildChatCompletionsBody(
  model: string,
  messages: ChatMessage[],
  options: ChatCompletionsOptions,
  mode: 'full' | 'compat',
  stream = false,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: 0.2,
    stream,
  };
  if (options.jsonObject) {
    body.response_format = { type: 'json_object' };
  }
  // Ollama /v1 honors reasoning_effort; native-style servers may honor think.
  // Unknown fields are ignored by most OpenAI-compatible gateways; 400 → compat retry.
  if (options.disableThinking !== false && mode === 'full') {
    body.think = false;
    body.reasoning_effort = 'none';
    body.chat_template_kwargs = { enable_thinking: false };
  }
  return body;
}

/** Parse one OpenAI-compatible chat.completion.chunk JSON payload. */
export function deltaTextFromChatChunk(payload: unknown): string {
  if (!payload || typeof payload !== 'object') {
    return '';
  }
  const choice = (payload as { choices?: Array<{ delta?: Record<string, unknown> }> })
    .choices?.[0];
  const delta = choice?.delta;
  if (!delta || typeof delta !== 'object') {
    return '';
  }
  const parts: string[] = [];
  for (const key of ['content', 'reasoning', 'reasoning_content'] as const) {
    const value = delta[key];
    if (typeof value === 'string' && value.length > 0) {
      parts.push(value);
    }
  }
  return parts.join('');
}

/**
 * Consume an OpenAI-compatible SSE body into assistant text.
 * Invokes onDelta for each visible text fragment (for UI Details).
 */
export async function consumeChatCompletionsSse(
  body: ReadableStream<Uint8Array> | null,
  onDelta?: (text: string) => void,
): Promise<{ content: string; model: string | null }> {
  if (!body) {
    throw new Error('Vision LLM chat/completions stream missing body');
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let reasoning = '';
  let model: string | null = null;

  const applyChunk = (rawLine: string) => {
    const line = rawLine.trim();
    if (!line || line.startsWith(':')) {
      return;
    }
    if (!line.startsWith('data:')) {
      return;
    }
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') {
      return;
    }
    let payload: {
      model?: string;
      choices?: Array<{
        delta?: {
          content?: string | null;
          reasoning?: string | null;
          reasoning_content?: string | null;
        };
      }>;
    };
    try {
      payload = JSON.parse(data) as typeof payload;
    } catch {
      return;
    }
    if (payload.model?.trim()) {
      model = payload.model.trim();
    }
    const delta = payload.choices?.[0]?.delta;
    if (!delta) {
      return;
    }
    if (typeof delta.content === 'string' && delta.content) {
      content += delta.content;
      // Details UI shows translation JSON only — never stream thinking/reasoning tokens.
      onDelta?.(delta.content);
    }
    const reasonPart = delta.reasoning_content ?? delta.reasoning;
    if (typeof reasonPart === 'string' && reasonPart) {
      reasoning += reasonPart;
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      applyChunk(line.endsWith('\r') ? line.slice(0, -1) : line);
      newline = buffer.indexOf('\n');
    }
  }
  if (buffer.trim()) {
    applyChunk(buffer);
  }

  const assembled = extractChatMessageContent({
    content,
    reasoning,
  });
  return { content: assembled, model };
}

/** Prefer assistant content; some gateways put the answer after </think> or in reasoning. */
export function extractChatMessageContent(message: {
  content?: string | null;
  reasoning?: string | null;
  reasoning_content?: string | null;
} | null | undefined): string {
  const raw = message?.content?.trim() ?? '';
  if (raw) {
    const split = raw.split(/<\/think>/i);
    if (split.length > 1) {
      const after = split[split.length - 1]?.trim() ?? '';
      if (after) {
        return after;
      }
    }
    return raw;
  }
  const reasoning = (
    message?.reasoning_content ??
    message?.reasoning ??
    ''
  ).trim();
  if (!reasoning) {
    return '';
  }
  const split = reasoning.split(/<\/think>/i);
  return (split[split.length - 1] ?? reasoning).trim();
}

export async function chatCompletions(
  config: VisionLlmConfig,
  messages: ChatMessage[],
  options: ChatCompletionsOptions = {},
): Promise<ChatCompletionsResult> {
  const baseUrl = config.baseUrl.replace(/\/$/, '');
  const apiKey = config.apiKey?.trim() || 'ollama';
  const model = config.model.trim() || 'gpt-4o-mini';
  const timeoutMs = config.timeoutMs ?? 120_000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const attempt = async (mode: 'full' | 'compat') => {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(
          buildChatCompletionsBody(model, messages, options, mode, false),
        ),
        signal: controller.signal,
      });
      const rawBody = await response.text();
      return { response, rawBody };
    };

    let { response, rawBody } = await attempt('full');
    if (
      !response.ok &&
      response.status === 400 &&
      options.disableThinking !== false
    ) {
      ({ response, rawBody } = await attempt('compat'));
    }

    if (!response.ok) {
      throw new Error(
        `Vision LLM chat/completions failed (${response.status}): ${rawBody.slice(0, 500)}`,
      );
    }

    let payload: {
      model?: string;
      choices?: Array<{
        message?: {
          content?: string | null;
          reasoning?: string | null;
          reasoning_content?: string | null;
        };
      }>;
    };
    try {
      payload = JSON.parse(rawBody) as typeof payload;
    } catch {
      const snippet = rawBody.replace(/\s+/g, ' ').trim().slice(0, 200);
      throw new Error(
        `Vision LLM chat/completions returned non-JSON (check Admin → AI Providers base URL ends with /v1): ${snippet}`,
      );
    }
    const content = extractChatMessageContent(payload.choices?.[0]?.message);
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

export async function chatCompletionsStream(
  config: VisionLlmConfig,
  messages: ChatMessage[],
  options: ChatCompletionsOptions = {},
  onDelta?: (text: string) => void,
): Promise<ChatCompletionsResult> {
  const baseUrl = config.baseUrl.replace(/\/$/, '');
  const apiKey = config.apiKey?.trim() || 'ollama';
  const model = config.model.trim() || 'gpt-4o-mini';
  const timeoutMs = config.timeoutMs ?? 120_000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const attempt = async (mode: 'full' | 'compat') =>
      fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          Accept: 'text/event-stream',
        },
        body: JSON.stringify(
          buildChatCompletionsBody(model, messages, options, mode, true),
        ),
        signal: controller.signal,
      });

    let response = await attempt('full');
    if (
      !response.ok &&
      response.status === 400 &&
      options.disableThinking !== false
    ) {
      response = await attempt('compat');
    }

    if (!response.ok) {
      const rawBody = await response.text();
      throw new Error(
        `Vision LLM chat/completions failed (${response.status}): ${rawBody.slice(0, 500)}`,
      );
    }

    const { content, model: streamedModel } = await consumeChatCompletionsSse(
      response.body,
      onDelta,
    );
    if (!content) {
      throw new Error('Vision LLM chat/completions stream missing content');
    }

    return {
      content,
      model: streamedModel?.trim() || model,
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
  let text = content
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');
  // Unclosed think block (truncated / thinking-off quirks): drop the preamble.
  text = text.replace(/<think>[\s\S]*$/i, '');
  text = text.replace(/<thinking>[\s\S]*$/i, '');
  return text.trim();
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

/**
 * Extract JSON object from model output (raw or whole-response fence).
 * Important: do NOT treat ``` fences inside contentMarkdown string values as a
 * JSON wrapper — that breaks records that contain code samples.
 */
export function parseTranslationJson(content: string): {
  title: string;
  summary: string | null;
  contentMarkdown: string;
} {
  const trimmed = stripModelReasoning(content);
  // Only unwrap a fence that wraps the entire assistant message.
  const wholeFence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = (wholeFence?.[1] ?? trimmed).trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch (firstError) {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start < 0 || end <= start) {
      const snippet = candidate.replace(/\s+/g, ' ').slice(0, 160);
      throw new Error(
        `Translation model output is not valid JSON: ${snippet || '(empty)'}`,
      );
    }
    try {
      parsed = JSON.parse(candidate.slice(start, end + 1));
    } catch {
      const detail =
        firstError instanceof Error ? firstError.message : 'parse failed';
      throw new Error(`Translation model output is not valid JSON (${detail})`);
    }
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
  onProgress?: (event: TranslationProgressEvent) => void;
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
    'Translate EVERY human-readable string (title, summary, body) into the target language.',
    'Never copy the source title/body unchanged when the target language differs.',
    'Do not chain-of-thought, explain, or emit thinking tags; output the final JSON immediately.',
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

  const llmConfig = {
    baseUrl: input.baseUrl,
    apiKey: input.apiKey,
    model: input.model,
    timeoutMs: input.timeoutMs,
  };
  const baseMessages: ChatMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: userPayload },
  ];

  const emitDelta = (text: string) => {
    if (text) {
      input.onProgress?.({ type: 'llm_delta', text });
    }
  };

  const runModel = async (
    msgs: ChatMessage[],
    disableThinking: boolean,
    stage: TranslationProgressStage = 'calling_model',
    message?: string,
  ) => {
    input.onProgress?.({
      type: 'stage',
      stage,
      model: input.model,
      message,
    });
    const options = { jsonObject: true, disableThinking };
    if (input.onProgress) {
      return chatCompletionsStream(llmConfig, msgs, options, emitDelta);
    }
    return chatCompletions(llmConfig, msgs, options);
  };

  const isEcho = (fields: ReturnType<typeof parseTranslationJson>) => {
    const sourceBody = input.contentMarkdown.trim();
    const translatedBody = unescapeLiteralNewlines(fields.contentMarkdown).trim();
    const sourceTitle = input.title.trim();
    return (
      sourceBody.length > 0 &&
      translatedBody === sourceBody &&
      fields.title.trim() === sourceTitle &&
      input.targetLanguage.trim().toLowerCase() !==
        (input.sourceLanguage?.trim().toLowerCase() || '')
    );
  };

  // Fast path: thinking off (works well on larger models).
  // Tiny Qwen3 models often echo the source — then one thinking-on retry.
  let { content, model } = await runModel(baseMessages, true);

  let fields: ReturnType<typeof parseTranslationJson>;
  let needsThinkingRetry = false;
  try {
    fields = parseTranslationJson(content);
    needsThinkingRetry = isEcho(fields);
  } catch {
    needsThinkingRetry = true;
    fields = {
      title: input.title,
      summary: input.summary,
      contentMarkdown: input.contentMarkdown,
    };
  }

  if (needsThinkingRetry) {
    ({ content, model } = await runModel(
      [
        ...baseMessages,
        { role: 'assistant', content },
        {
          role: 'user',
          content:
            `Translate into ${input.targetLanguage}. Do not copy the source language. ` +
            'Reply with ONLY one JSON object (title, summary, contentMarkdown).',
        },
      ],
      false,
      'retrying',
      'Retrying with deeper model reasoning for a real translation',
    ));
    fields = parseTranslationJson(content);
  }

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
