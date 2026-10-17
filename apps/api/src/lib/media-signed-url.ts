import { createHmac, timingSafeEqual } from 'node:crypto';

/** Middle of the 5–15 minute window. */
export const MEDIA_SIGNED_URL_TTL_SECONDS = 10 * 60;

export const MEDIA_SIGNED_URL_MIN_TTL_SECONDS = 5 * 60;
export const MEDIA_SIGNED_URL_MAX_TTL_SECONDS = 15 * 60;

const PURPOSE = 'media-read.v1';

function signingPayload(mediaId: string, workspaceId: string, exp: number): string {
  return `${PURPOSE}.${mediaId}.${workspaceId}.${exp}`;
}

export function signMediaRead(input: {
  secret: string;
  mediaId: string;
  workspaceId: string;
  exp: number;
}): string {
  return createHmac('sha256', input.secret)
    .update(signingPayload(input.mediaId, input.workspaceId, input.exp))
    .digest('base64url');
}

function signaturesMatch(actual: string, expected: string): boolean {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export type MediaReadSignatureVerdict = 'ok' | 'expired' | 'invalid';

/**
 * HMAC over media id, workspace id, and expiry. A signature for another
 * media row or workspace does not verify. Expiry is an absolute unix second.
 */
export function verifyMediaRead(input: {
  secret: string;
  mediaId: string;
  workspaceId: string;
  exp: string;
  sig: string;
  nowMs?: number;
}): MediaReadSignatureVerdict {
  if (!/^\d{1,12}$/.test(input.exp) || !input.sig) return 'invalid';
  const exp = Number(input.exp);
  if (!Number.isSafeInteger(exp)) return 'invalid';
  const expected = signMediaRead({
    secret: input.secret,
    mediaId: input.mediaId,
    workspaceId: input.workspaceId,
    exp,
  });
  if (!signaturesMatch(input.sig, expected)) return 'invalid';
  const now = Math.floor((input.nowMs ?? Date.now()) / 1000);
  if (exp - now > MEDIA_SIGNED_URL_MAX_TTL_SECONDS) return 'invalid';
  if (now >= exp) return 'expired';
  return 'ok';
}

export function mediaReadOrigin(env: { WEB_URL: string; MCP_PUBLIC_URL?: string | null }): string {
  const override = env.MCP_PUBLIC_URL?.trim();
  if (override) {
    try {
      return new URL(override).origin;
    } catch {
      // Fall through to the public web origin, which proxies /api/v1.
    }
  }
  return env.WEB_URL.replace(/\/$/, '');
}

export function buildSignedMediaUrl(input: {
  origin: string;
  secret: string;
  mediaId: string;
  workspaceId: string;
  ttlSeconds?: number;
  nowMs?: number;
}): { signedUrl: string; expiresAt: string } {
  const ttl = input.ttlSeconds ?? MEDIA_SIGNED_URL_TTL_SECONDS;
  if (ttl < MEDIA_SIGNED_URL_MIN_TTL_SECONDS || ttl > MEDIA_SIGNED_URL_MAX_TTL_SECONDS) {
    throw new Error('Signed media URL TTL must be between 5 and 15 minutes');
  }
  const exp = Math.floor((input.nowMs ?? Date.now()) / 1000) + ttl;
  const sig = signMediaRead({
    secret: input.secret,
    mediaId: input.mediaId,
    workspaceId: input.workspaceId,
    exp,
  });
  const origin = input.origin.replace(/\/$/, '');
  const signedUrl = `${origin}/api/v1/media/${input.mediaId}?exp=${exp}&sig=${encodeURIComponent(sig)}`;
  return {
    signedUrl,
    expiresAt: new Date(exp * 1000).toISOString(),
  };
}
