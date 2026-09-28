import { describe, expect, it } from 'vitest';
import { systemItDetailsPatchSchema } from '@project-knowledge-hub/domain';
import {
  normalizeCriticalityInput,
  parseItDetails,
} from './systems.js';
import { mergeItDetails } from './systems-it-details.js';

describe('systems IT details helpers', () => {
  it('parses itDetails and drops unknown keys', () => {
    const parsed = parseItDetails({
      hostname: 'db.internal',
      primaryUrl: 'https://db.example.com',
      vendor: 'PostgreSQL',
      junk: true,
    });
    expect(parsed).toEqual({
      hostname: 'db.internal',
      primaryUrl: 'https://db.example.com',
      vendor: 'PostgreSQL',
    });
  });

  it('normalizes criticality aliases', () => {
    expect(normalizeCriticalityInput('MEDIUM')).toBe('medium');
    expect(normalizeCriticalityInput(null)).toBeNull();
    expect(normalizeCriticalityInput(undefined)).toBeUndefined();
  });
});

describe('mergeItDetails', () => {
  it('preserves other keys when updating one field', () => {
    const existing = {
      hostname: 'qa-host.example',
      ports: [{ port: 443, protocol: 'tcp' }],
      notes: 'full set',
    };
    const patch = { notes: 'partial 2' };
    const result = mergeItDetails(existing, patch);

    expect(result).toEqual({
      hostname: 'qa-host.example',
      ports: [{ port: 443, protocol: 'tcp' }],
      notes: 'partial 2',
    });
  });

  it('removes keys set to null', () => {
    const existing = {
      hostname: 'db.internal',
      primaryUrl: 'https://db.example.com',
      vendor: 'PostgreSQL',
    };
    const patch = { vendor: null };
    const result = mergeItDetails(existing, patch);

    expect(result).toEqual({
      hostname: 'db.internal',
      primaryUrl: 'https://db.example.com',
    });
  });

  it('removes keys set to undefined', () => {
    const existing = {
      hostname: 'db.internal',
      primaryUrl: 'https://db.example.com',
      vendor: 'PostgreSQL',
    };
    const patch = { vendor: undefined };
    const result = mergeItDetails(existing, patch);

    expect(result).toEqual({
      hostname: 'db.internal',
      primaryUrl: 'https://db.example.com',
    });
  });

  it('replaces arrays entirely rather than merging elements', () => {
    const existing = {
      ports: [
        { port: 443, protocol: 'tcp' },
        { port: 80, protocol: 'tcp' },
      ],
      ipAddresses: ['10.0.1.1', '10.0.1.2'],
    };
    const patch = {
      ports: [{ port: 8080, protocol: 'tcp', service: 'web' }],
    };
    const result = mergeItDetails(existing, patch);

    expect(result).toEqual({
      ports: [{ port: 8080, protocol: 'tcp', service: 'web' }],
      ipAddresses: ['10.0.1.1', '10.0.1.2'],
    });
    expect(result.ports).toHaveLength(1);
  });

  it('handles empty patch as no-op', () => {
    const existing = {
      hostname: 'srv.example',
      vendor: 'Acme',
    };
    const patch = {};
    const result = mergeItDetails(existing, patch);

    expect(result).toEqual(existing);
  });

  it('handles null patch as no-op', () => {
    const existing = {
      hostname: 'srv.example',
      vendor: 'Acme',
    };
    const result = mergeItDetails(existing, null);

    expect(result).toEqual(existing);
  });

  it('validates merged result against itDetails schema', () => {
    const existing = {
      hostname: 'valid.example',
    };
    const patch = {
      ports: [{ port: 99999999999 }], // port out of range
    };

    expect(() => mergeItDetails(existing, patch as never)).toThrow();
  });

  it('strips unknown keys from patch during merge', () => {
    const existing = {
      hostname: 'db.example',
    };
    const patch = {
      vendor: 'MySQL',
      unknownField: 'should be removed',
    };
    const result = mergeItDetails(existing, patch as never);

    expect(result).toEqual({
      hostname: 'db.example',
      vendor: 'MySQL',
    });
    expect('unknownField' in result).toBe(false);
  });

  it('allows adding new valid keys to existing itDetails', () => {
    const existing = {
      hostname: 'app.example',
    };
    const patch = {
      primaryUrl: 'https://app.example.com',
      dataClassification: 'confidential' as const,
    };
    const result = mergeItDetails(existing, patch);

    expect(result).toEqual({
      hostname: 'app.example',
      primaryUrl: 'https://app.example.com',
      dataClassification: 'confidential',
    });
  });

  it('handles endpoints array replacement', () => {
    const existing = {
      endpoints: [
        { name: 'API', url: 'https://api.example.com' },
        { name: 'Admin', url: 'https://admin.example.com' },
      ],
    };
    const patch = {
      endpoints: [{ name: 'GraphQL', url: 'https://gql.example.com' }],
    };
    const result = mergeItDetails(existing, patch);

    expect(result).toEqual({
      endpoints: [{ name: 'GraphQL', url: 'https://gql.example.com' }],
    });
  });

  it('handles dependencies array replacement', () => {
    const existing = {
      dependencies: ['redis', 'postgres', 'rabbitmq'],
    };
    const patch = {
      dependencies: ['postgres'],
    };
    const result = mergeItDetails(existing, patch);

    expect(result).toEqual({
      dependencies: ['postgres'],
    });
  });

  it('validates enum values in merged result', () => {
    const existing = {
      hostname: 'web.example',
    };
    const patch = {
      deploymentModel: 'invalid_model',
    };

    expect(() => mergeItDetails(existing, patch as never)).toThrow();
  });
});

describe('mergeItDetails with systemItDetailsPatchSchema (end-to-end)', () => {
  it('parses patch schema then merges, where null removes a key', () => {
    const existing = {
      hostname: 'qa-host.example',
      vendor: 'Acme',
      ports: [{ port: 443, protocol: 'tcp' }],
    };

    const rawPatch = {
      vendor: null,
      notes: 'updated notes',
    };

    const parsedPatch = systemItDetailsPatchSchema.parse(rawPatch);
    const result = mergeItDetails(existing, parsedPatch);

    expect(result).toEqual({
      hostname: 'qa-host.example',
      ports: [{ port: 443, protocol: 'tcp' }],
      notes: 'updated notes',
    });
    expect('vendor' in result).toBe(false);
  });

  it('parses patch with empty array and merges', () => {
    const existing = {
      hostname: 'web.example',
      ports: [{ port: 80 }, { port: 443 }],
      ipAddresses: ['10.0.1.1'],
    };

    const rawPatch = {
      ports: [],
    };

    const parsedPatch = systemItDetailsPatchSchema.parse(rawPatch);
    const result = mergeItDetails(existing, parsedPatch);

    expect(result).toEqual({
      hostname: 'web.example',
      ports: [],
      ipAddresses: ['10.0.1.1'],
    });
  });
});
