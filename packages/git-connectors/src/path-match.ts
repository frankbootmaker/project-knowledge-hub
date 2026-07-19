/** Minimal gitignore-style matcher for include/exclude path globs. */

function globToRegExp(pattern: string): RegExp {
  const normalized = pattern.replace(/\\/g, '/').replace(/^\.\//, '');
  let regex = '^';
  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i]!;
    if (char === '*' && normalized[i + 1] === '*') {
      regex += '.*';
      i += 1;
      if (normalized[i + 1] === '/') {
        i += 1;
      }
      continue;
    }
    if (char === '*') {
      regex += '[^/]*';
      continue;
    }
    if (char === '?') {
      regex += '[^/]';
      continue;
    }
    if ('+^$()[]{}|.'.includes(char)) {
      regex += `\\${char}`;
      continue;
    }
    regex += char;
  }
  regex += '$';
  return new RegExp(regex);
}

export function pathMatches(path: string, patterns: string[]): boolean {
  const normalized = path.replace(/\\/g, '/').replace(/^\.\//, '');
  return patterns.some((pattern) => globToRegExp(pattern).test(normalized));
}

export function isMarkdownPath(path: string): boolean {
  return /\.(md|mdx|markdown)$/i.test(path);
}

export function filterSyncedPaths(
  paths: string[],
  includePaths: string[],
  excludePaths: string[],
): string[] {
  return paths.filter((path) => {
    if (!isMarkdownPath(path)) return false;
    if (includePaths.length > 0 && !pathMatches(path, includePaths)) return false;
    if (excludePaths.length > 0 && pathMatches(path, excludePaths)) return false;
    return true;
  });
}
