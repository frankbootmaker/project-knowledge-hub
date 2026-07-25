import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Drizzle SQL lives in `src/migrations`. Scripts run via tsx resolve next to
 * the source file; the compiled API import resolves next to `dist/` and must
 * fall back to `../src/migrations`.
 */
export function resolveMigrationsFolder(fromMetaUrl: string = import.meta.url): string {
  const here = path.dirname(fileURLToPath(fromMetaUrl));
  const candidates = [
    path.join(here, 'migrations'),
    path.join(here, '../src/migrations'),
    path.join(here, 'src/migrations'),
  ];
  for (const folder of candidates) {
    if (fs.existsSync(path.join(folder, 'meta/_journal.json'))) {
      return folder;
    }
  }
  throw new Error(
    `Cannot find drizzle migrations (meta/_journal.json). Tried: ${candidates.join(', ')}`,
  );
}
