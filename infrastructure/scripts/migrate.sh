#!/usr/bin/env bash
# Apply Drizzle migrations against DATABASE_URL (pgvector Postgres required for M10+).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required" >&2
  exit 1
fi

if [[ -x "$ROOT_DIR/node_modules/.bin/tsx" ]]; then
  exec "$ROOT_DIR/node_modules/.bin/tsx" packages/database/src/migrate.ts
fi

if command -v pnpm >/dev/null 2>&1; then
  exec pnpm --filter @project-knowledge-hub/database migrate
fi

echo "Neither local tsx nor pnpm found. Install deps (pnpm install) or run inside the api image:" >&2
echo "  node node_modules/tsx/dist/cli.mjs packages/database/src/migrate.ts" >&2
exit 1
