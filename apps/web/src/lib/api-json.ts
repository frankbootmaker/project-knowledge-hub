/**
 * Parse a fetch Response as JSON with a clear error when the body is HTML/empty
 * (common for Next rewrite / Traefik timeouts on long AI requests).
 */
export async function readApiJson<T = unknown>(
  response: Response,
): Promise<T> {
  const text = await response.text();
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error(
      `Empty response from server (HTTP ${response.status}). If this was an AI action, check Next proxyTimeout / Traefik timeouts and Admin → AI Providers.`,
    );
  }

  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const looksHtml = trimmed.startsWith('<') || /<!DOCTYPE/i.test(trimmed);
    const looksProxyTimeout =
      response.status === 500 &&
      /^Internal Server Error$/i.test(trimmed);
    const snippet = trimmed.replace(/\s+/g, ' ').slice(0, 160);
    throw new Error(
      looksProxyTimeout
        ? `Proxy timed out before the API finished (HTTP 500). AI translate often needs >30s — ensure web experimental.proxyTimeout is raised and Traefik readTimeout allows long LLM calls, or retry without AI translate.`
        : looksHtml
          ? `Server returned HTML instead of JSON (HTTP ${response.status}). Often a proxy timeout or gateway error during a long AI call — increase Traefik readTimeout, or retry without AI translate.`
          : `Server returned non-JSON (HTTP ${response.status}): ${snippet}`,
    );
  }
}
