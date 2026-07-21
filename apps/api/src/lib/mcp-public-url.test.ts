import { describe, expect, it } from 'vitest';
import {
  defaultMcpUrlFromApi,
  defaultPublicMcpUrlFromWeb,
  normalizeMcpPublicUrl,
  publicOriginFromWebUrl,
} from './mcp-public-url.js';

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

describe('defaultPublicMcpUrlFromWeb', () => {
  it('builds same-origin public MCP from WEB_URL', () => {
    expect(defaultPublicMcpUrlFromWeb('https://knowhub-dev.example.com')).toBe(
      'https://knowhub-dev.example.com/mcp',
    );
  });
});

describe('publicOriginFromWebUrl', () => {
  it('strips trailing slash', () => {
    expect(publicOriginFromWebUrl('https://knowhub-dev.example.com/')).toBe(
      'https://knowhub-dev.example.com',
    );
  });
});
