import { describe, expect, it } from 'vitest';
import { readApiJson } from './api-json';

describe('readApiJson', () => {
  it('parses JSON bodies', async () => {
    const response = new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
    await expect(readApiJson<{ ok: boolean }>(response)).resolves.toEqual({
      ok: true,
    });
  });

  it('explains HTML gateway responses', async () => {
    const response = new Response('<html><body>Bad Gateway</body></html>', {
      status: 502,
    });
    await expect(readApiJson(response)).rejects.toThrow(/HTML instead of JSON/);
  });

  it('explains empty bodies', async () => {
    const response = new Response('', { status: 504 });
    await expect(readApiJson(response)).rejects.toThrow(/Empty response/);
  });

  it('explains Next rewrite proxy timeout bodies', async () => {
    const response = new Response('Internal Server Error', { status: 500 });
    await expect(readApiJson(response)).rejects.toThrow(/Proxy timed out/);
  });
});

