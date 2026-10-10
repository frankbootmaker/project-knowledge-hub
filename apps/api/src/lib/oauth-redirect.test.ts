import { describe, expect, it } from 'vitest';
import {
  NATIVE_LOOPBACK_REDIRECT,
  oauthRedirectMatches,
  publishedRedirectMatches,
  redirectAllowed,
  withNativeLoopbackRedirect,
} from './oauth-redirect.js';

describe('OAuth loopback redirect matching', () => {
  it('accepts an ephemeral loopback port against the portless native callback', () => {
    expect(
      oauthRedirectMatches('http://127.0.0.1:62225/callback', NATIVE_LOOPBACK_REDIRECT),
    ).toBe(true);
    expect(
      publishedRedirectMatches('http://127.0.0.1:62225/callback', [
        NATIVE_LOOPBACK_REDIRECT,
      ]),
    ).toBe(true);
    expect(
      redirectAllowed('http://127.0.0.1:62225/callback', [NATIVE_LOOPBACK_REDIRECT]),
    ).toBe(true);
  });

  it('keeps scheme, host, path, and query exact for loopback callbacks', () => {
    expect(
      oauthRedirectMatches('https://127.0.0.1:62225/callback', NATIVE_LOOPBACK_REDIRECT),
    ).toBe(false);
    expect(
      oauthRedirectMatches('http://localhost:62225/callback', NATIVE_LOOPBACK_REDIRECT),
    ).toBe(false);
    expect(
      oauthRedirectMatches('http://127.0.0.1:62225/callback/extra', NATIVE_LOOPBACK_REDIRECT),
    ).toBe(false);
    expect(
      oauthRedirectMatches(
        'http://127.0.0.1:62225/callback?next=1',
        NATIVE_LOOPBACK_REDIRECT,
      ),
    ).toBe(false);
    expect(
      oauthRedirectMatches('http://[::1]:62225/callback', 'http://[::1]/callback'),
    ).toBe(true);
  });

  it('keeps exact matching for non-loopback callbacks', () => {
    const chatgpt = 'https://chatgpt.com/connector_platform_oauth_redirect';
    expect(oauthRedirectMatches(chatgpt, chatgpt)).toBe(true);
    expect(
      oauthRedirectMatches('https://chatgpt.com/connector_platform_oauth_redirect/extra', chatgpt),
    ).toBe(false);
    expect(
      oauthRedirectMatches('https://evil.example/callback', chatgpt),
    ).toBe(false);
    expect(
      redirectAllowed('https://chatgpt.com/oauth/callback', ['https://chatgpt.com/oauth/']),
    ).toBe(true);
    expect(
      redirectAllowed('https://chatgpt.com.evil/oauth/callback', ['https://chatgpt.com/oauth/']),
    ).toBe(false);
  });

  it('adds the native loopback callback when an older allowlist omitted it', () => {
    expect(
      withNativeLoopbackRedirect([
        'https://chatgpt.com/connector_platform_oauth_redirect',
      ]),
    ).toEqual([
      'https://chatgpt.com/connector_platform_oauth_redirect',
      NATIVE_LOOPBACK_REDIRECT,
    ]);
    expect(
      withNativeLoopbackRedirect(['http://127.0.0.1:9/callback']),
    ).toEqual(['http://127.0.0.1:9/callback']);
  });
});
