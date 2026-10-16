const SENSITIVE_QUERY_PARAMS = new Set(['code', 'state']);

export function redactSensitiveQueryParams(url: string): string {
  const qIndex = url.indexOf('?');
  if (qIndex === -1) {
    return url;
  }
  const path = url.slice(0, qIndex);
  const params = new URLSearchParams(url.slice(qIndex + 1));
  for (const key of [...params.keys()]) {
    if (SENSITIVE_QUERY_PARAMS.has(key.toLowerCase())) {
      params.set(key, '[Redacted]');
    }
  }
  const search = params.toString();
  return search ? `${path}?${search}` : path;
}
