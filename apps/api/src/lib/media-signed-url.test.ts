import { describe, expect, it } from 'vitest';
import {
  MEDIA_SIGNED_URL_TTL_SECONDS,
  buildSignedMediaUrl,
  signMediaRead,
  verifyMediaRead,
} from './media-signed-url.js';

const secret = 'test-session-secret-at-least-32-chars';
const mediaId = '11111111-1111-4111-8111-111111111111';
const workspaceId = '22222222-2222-4222-8222-222222222222';
const nowMs = Date.parse('2026-10-17T12:00:00.000Z');

describe('signed media URLs', () => {
  it('binds a URL to the media id and workspace for 10 minutes', () => {
    const signed = buildSignedMediaUrl({
      origin: 'https://knowledge.example.com',
      secret,
      mediaId,
      workspaceId,
      nowMs,
    });
    const url = new URL(signed.signedUrl);
    expect(url.origin).toBe('https://knowledge.example.com');
    expect(url.pathname).toBe(`/api/v1/media/${mediaId}`);
    expect(signed.expiresAt).toBe(
      new Date(nowMs + MEDIA_SIGNED_URL_TTL_SECONDS * 1000).toISOString(),
    );
    expect(
      verifyMediaRead({
        secret,
        mediaId,
        workspaceId,
        exp: url.searchParams.get('exp') ?? '',
        sig: url.searchParams.get('sig') ?? '',
        nowMs: nowMs + 60_000,
      }),
    ).toBe('ok');
  });

  it('rejects an expired signature', () => {
    const exp = Math.floor(nowMs / 1000) + 60;
    const sig = signMediaRead({ secret, mediaId, workspaceId, exp });
    expect(
      verifyMediaRead({
        secret,
        mediaId,
        workspaceId,
        exp: String(exp),
        sig,
        nowMs: exp * 1000,
      }),
    ).toBe('expired');
  });

  it('rejects a signature for a different media id or workspace', () => {
    const exp = Math.floor(nowMs / 1000) + 600;
    const sig = signMediaRead({ secret, mediaId, workspaceId, exp });
    const otherMedia = '33333333-3333-4333-8333-333333333333';
    const otherWorkspace = '44444444-4444-4444-8444-444444444444';
    expect(
      verifyMediaRead({
        secret,
        mediaId: otherMedia,
        workspaceId,
        exp: String(exp),
        sig,
        nowMs,
      }),
    ).toBe('invalid');
    expect(
      verifyMediaRead({
        secret,
        mediaId,
        workspaceId: otherWorkspace,
        exp: String(exp),
        sig,
        nowMs,
      }),
    ).toBe('invalid');
  });

  it('rejects a signature that lives longer than 15 minutes', () => {
    const exp = Math.floor(nowMs / 1000) + 16 * 60;
    const sig = signMediaRead({ secret, mediaId, workspaceId, exp });
    expect(
      verifyMediaRead({
        secret,
        mediaId,
        workspaceId,
        exp: String(exp),
        sig,
        nowMs,
      }),
    ).toBe('invalid');
  });
});
