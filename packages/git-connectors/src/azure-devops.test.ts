import { describe, expect, it } from 'vitest';
import { parseAzureRepo } from './azure-devops.js';

describe('parseAzureRepo', () => {
  it('splits project/repo', () => {
    expect(parseAzureRepo('MyProject/docs-repo')).toEqual({
      project: 'MyProject',
      repoName: 'docs-repo',
    });
  });

  it('rejects missing slash', () => {
    expect(() => parseAzureRepo('just-repo')).toThrow(/project\/repo/);
  });
});
