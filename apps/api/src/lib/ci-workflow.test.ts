import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const workflowPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../.github/workflows/ci.yml',
);

describe('PRO-T-34 CI push branches', () => {
  const workflow = readFileSync(workflowPath, 'utf8');
  const pushBlock = workflow.slice(
    workflow.indexOf('on:'),
    workflow.indexOf('concurrency:'),
  );

  it('pushes to master, feature/new-design, and integration/batch', () => {
    expect(pushBlock).toContain('master');
    expect(pushBlock).toContain('feature/new-design');
    expect(pushBlock).toContain('integration/batch');
    expect(pushBlock).not.toMatch(/branches:\s*\[[^\]]*main[^\]]*\]/);
  });
});
