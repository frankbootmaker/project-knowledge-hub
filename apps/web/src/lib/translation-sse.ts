export type TranslationStreamStage =
  | 'preparing'
  | 'calling_model'
  | 'retrying'
  | 'saving';

export type TranslationStreamHandlers = {
  onStage?: (stage: {
    stage: TranslationStreamStage;
    model?: string;
    message?: string;
  }) => void;
  onLlmDelta?: (text: string) => void;
  onDone?: (knowledgeRecord: { slug: string; id?: string }) => void;
  onError?: (error: { message: string; code?: string }) => void;
};

/** Split SSE buffer into complete events (separated by blank lines). */
export function splitSseBuffer(buffer: string): {
  events: string[];
  rest: string;
} {
  const normalized = buffer.replace(/\r\n/g, '\n');
  const parts = normalized.split('\n\n');
  const rest = parts.pop() ?? '';
  return { events: parts.filter((part) => part.trim().length > 0), rest };
}

export function parseSseEventBlock(block: string): {
  event: string;
  data: string;
} {
  let event = 'message';
  const dataLines: string[] = [];
  for (const rawLine of block.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (!line || line.startsWith(':')) {
      continue;
    }
    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
      continue;
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
  }
  return { event, data: dataLines.join('\n') };
}

export async function consumeTranslationSse(
  response: Response,
  handlers: TranslationStreamHandlers,
): Promise<void> {
  if (!response.body) {
    throw new Error('Translation stream returned an empty body');
  }
  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      text.trim() || `Translation stream failed (HTTP ${response.status})`,
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let sawTerminal = false;

  const handleBlock = (block: string) => {
    const { event, data } = parseSseEventBlock(block);
    if (!data) {
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }
    if (event === 'stage' && parsed && typeof parsed === 'object') {
      const row = parsed as {
        stage?: string;
        model?: string;
        message?: string;
      };
      if (
        row.stage === 'preparing' ||
        row.stage === 'calling_model' ||
        row.stage === 'retrying' ||
        row.stage === 'saving'
      ) {
        handlers.onStage?.({
          stage: row.stage,
          model: row.model,
          message: row.message,
        });
      }
      return;
    }
    if (event === 'llm_delta' && parsed && typeof parsed === 'object') {
      const text = (parsed as { text?: unknown }).text;
      if (typeof text === 'string' && text) {
        handlers.onLlmDelta?.(text);
      }
      return;
    }
    if (event === 'done' && parsed && typeof parsed === 'object') {
      const record = (parsed as { knowledgeRecord?: { slug?: string; id?: string } })
        .knowledgeRecord;
      if (record?.slug) {
        sawTerminal = true;
        handlers.onDone?.(record as { slug: string; id?: string });
      }
      return;
    }
    if (event === 'error' && parsed && typeof parsed === 'object') {
      const row = parsed as { message?: string; code?: string };
      sawTerminal = true;
      handlers.onError?.({
        message: row.message?.trim() || 'Translation failed',
        code: row.code,
      });
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const split = splitSseBuffer(buffer);
    buffer = split.rest;
    for (const block of split.events) {
      handleBlock(block);
    }
  }
  if (buffer.trim()) {
    handleBlock(buffer);
  }
  if (!sawTerminal) {
    throw new Error('Translation stream ended without a result');
  }
}
