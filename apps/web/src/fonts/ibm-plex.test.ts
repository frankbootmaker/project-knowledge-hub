import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = join(here, '../..');

const FONT_FILES = [
  'IBMPlexSans-Regular.woff2',
  'IBMPlexSans-Medium.woff2',
  'IBMPlexSans-SemiBold.woff2',
  'IBMPlexSans-Bold.woff2',
  'IBMPlexSansCondensed-Regular.woff2',
  'IBMPlexSansCondensed-SemiBold.woff2',
  'IBMPlexSansCondensed-Bold.woff2',
  'IBMPlexMono-Regular.woff2',
  'IBMPlexMono-Medium.woff2',
] as const;

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, acc);
    else acc.push(path);
  }
  return acc;
}

describe('self-hosted web fonts', () => {
  it('does not reference Google Fonts from the web app source', () => {
    const offenders: string[] = [];
    for (const path of walk(join(webRoot, 'src'))) {
      if (!/\.(ts|tsx|css|mjs)$/.test(path) || path.endsWith('.test.ts')) continue;
      const text = readFileSync(path, 'utf8');
      if (
        text.includes('next/font/google') ||
        text.includes('fonts.googleapis.com') ||
        text.includes('fonts.gstatic.com')
      ) {
        offenders.push(path);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('loads IBM Plex through next/font/local with the same weights and variables', () => {
    const fonts = readFileSync(join(webRoot, 'src/fonts/ibm-plex.ts'), 'utf8');
    const layout = readFileSync(join(webRoot, 'src/app/layout.tsx'), 'utf8');
    expect(fonts).toContain("from 'next/font/local'");
    expect(fonts).toContain("display: 'swap'");
    expect(fonts).toContain("variable: '--font-ibm-plex-sans'");
    expect(fonts).toContain("variable: '--font-ibm-plex-sans-condensed'");
    expect(fonts).toContain("variable: '--font-ibm-plex-mono'");
    expect(fonts).toContain("weight: '400'");
    expect(fonts).toContain("weight: '500'");
    expect(fonts).toContain("weight: '600'");
    expect(fonts).toContain("weight: '700'");
    expect(layout).toContain('ibmPlexSans');
    expect(layout).toContain('ibmPlexSansCondensed');
    expect(layout).toContain('ibmPlexMono');
    expect(layout).not.toContain('next/font/google');
  });

  it('commits the woff2 files and the OFL license', () => {
    for (const name of FONT_FILES) {
      const bytes = readFileSync(join(webRoot, 'src/fonts', name));
      expect(bytes.subarray(0, 4).toString()).toBe('wOF2');
    }
    expect(readFileSync(join(webRoot, 'src/fonts/OFL.txt'), 'utf8')).toContain(
      'SIL OPEN FONT LICENSE',
    );
  });
});
