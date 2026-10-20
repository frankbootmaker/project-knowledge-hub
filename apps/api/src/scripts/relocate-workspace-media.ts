import { loadEnv } from '@project-knowledge-hub/config';
import { createDatabase } from '@project-knowledge-hub/database';
import { resolveBlobStore } from '../lib/blob-settings.js';
import { relocatePendingWorkspaceMedia } from '../lib/relocate-workspace-media.js';

type Args = {
  dryRun: boolean;
  limit?: number;
  mediaIds: string[];
};

function readArgs(argv: string[]): Args {
  const dryRun = argv.includes('--dry-run');
  const mediaIds = argv
    .filter((arg) => arg.startsWith('--media-id='))
    .map((arg) => arg.slice('--media-id='.length))
    .filter((id) => id.length > 0);
  const limitArg = argv.find((arg) => arg.startsWith('--limit='));
  if (!limitArg) return { dryRun, mediaIds };
  const limit = Number(limitArg.slice('--limit='.length));
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error('--limit must be a positive integer');
  }
  return { dryRun, limit, mediaIds };
}

async function main(): Promise<void> {
  const args = readArgs(process.argv.slice(2));
  const env = loadEnv();
  const database = createDatabase(env.DATABASE_URL);
  try {
    const { store } = await resolveBlobStore(database, env);
    const result = await relocatePendingWorkspaceMedia({
      database,
      uploadDir: env.MEDIA_UPLOAD_DIR,
      blobStore: store,
      dryRun: args.dryRun,
      limit: args.limit,
      mediaIds: args.mediaIds,
    });
    console.log(
      JSON.stringify({
        dryRun: args.dryRun,
        relocated: result.relocated,
        failed: result.failed,
        planned: result.planned,
        sourceDeleteFailed: result.sourceDeleteFailed,
      }),
    );
    if (result.failed > 0 || result.sourceDeleteFailed > 0) {
      process.exitCode = 1;
    }
  } finally {
    await database.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
