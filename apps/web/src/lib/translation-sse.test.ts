import { describe, expect, it, vi } from 'vitest';
import {
  consumeTranslationSse,
  parseSseEventBlock,
  splitSseBuffer,
} from './translation-sse';

describe('splitSseBuffer', () => {
  it('keeps an incomplete trailing event in the rest buffer', () => {
    const { events, rest } = splitSseBuffer(
      'event: stage\ndata: {"stage":"preparing"}\n\nevent: llm_delta\ndata: {"text":',
    );
    expect(events).toHaveLength(1);
    expect(rest.startsWith('event: llm_delta')).toBe(true);
  });
});

describe('parseSseEventBlock', () => {
  it('parses event name and JSON data', () => {
    expect(
      parseSseEventBlock('event: done\ndata: {"knowledgeRecord":{"slug":"x"}}'),
    ).toEqual({
      event: 'done',
      data: '{"knowledgeRecord":{"slug":"x"}}',
    });
  });
});

describe('consumeTranslationSse', () => {
  it('dispatches stage, delta, and done handlers', async () => {
    const body = [
      'event: stage\ndata: {"stage":"calling_model","model":"qwen3:4b"}\n\n',
      'event: llm_delta\ndata: {"text":"{\\"title\\""}\n\n',
      'event: done\ndata: {"knowledgeRecord":{"slug":"demo-de","id":"1"}}\n\n',
    ].join('');
    const response = new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });

    const onStage = vi.fn();
    const onLlmDelta = vi.fn();
    const onDone = vi.fn();
    const onError = vi.fn();

    await consumeTranslationSse(response, {
      onStage,
      onLlmDelta,
      onDone,
      onError,
    });

    expect(onStage).toHaveBeenCalledWith({
      stage: 'calling_model',
      model: 'qwen3:4b',
      message: undefined,
    });
    expect(onLlmDelta).toHaveBeenCalledWith('{"title"');
    expect(onDone).toHaveBeenCalledWith({ slug: 'demo-de', id: '1' });
    expect(onError).not.toHaveBeenCalled();
  });
});
