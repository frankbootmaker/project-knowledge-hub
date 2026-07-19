import { describe, expect, it } from 'vitest';
import { defaultMcpUrlFromApi, normalizeMcpPublicUrl } from './mcp-public-url.js';

describe('normalizeMcpPublicUrl', () => {
  it('appends /mcp when only a host is provided', () => {
    expect(normalizeMcpPublicUrl('https://knowledge.example.com')).toBe(
      'https://knowledge.example.com/mcp',
    );
  });

  it('keeps an explicit /mcp path', () => {
    expect(normalizeMcpPublicUrl('https://knowledge.example.com/mcp')).toBe(
      'https://knowledge.example.com/mcp',
    );
  });
});

describe('defaultMcpUrlFromApi', () => {
  it('builds from API_URL', () => {
    expect(defaultMcpUrlFromApi('http://localhost:3101/')).toBe(
      'http://localhost:3101/mcp',
    );
  });
});
