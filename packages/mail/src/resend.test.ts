import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RESEND_BASE_URL,
  normalizeResendBaseUrl,
} from './resend.js';

describe('normalizeResendBaseUrl', () => {
  it('defaults to Resend production API', () => {
    expect(normalizeResendBaseUrl()).toBe(DEFAULT_RESEND_BASE_URL);
    expect(normalizeResendBaseUrl('')).toBe(DEFAULT_RESEND_BASE_URL);
    expect(normalizeResendBaseUrl('   ')).toBe(DEFAULT_RESEND_BASE_URL);
  });

  it('strips trailing slash and /emails for Freeresend-style hosts', () => {
    expect(normalizeResendBaseUrl('https://api.freeresend.com/')).toBe(
      'https://api.freeresend.com',
    );
    expect(normalizeResendBaseUrl('https://api.freeresend.com/emails')).toBe(
      'https://api.freeresend.com',
    );
  });
});
