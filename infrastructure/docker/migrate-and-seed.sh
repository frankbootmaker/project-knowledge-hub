#!/bin/sh
# Dokploy migrate one-shot: preflight auth, apply Drizzle migrations, seed (non-fatal).
# Used as migrate service entrypoint so Compose does not mangle $?/shell vars.
set -eu

cd /app

USER_NAME="${POSTGRES_USER:-knowledge_hub}"
DB_NAME="${POSTGRES_DB:-knowledge_hub}"
HOST_NAME="${POSTGRES_HOST:-postgres}"
PORT_NUM="${POSTGRES_PORT:-5432}"
PASS_LEN=0
if [ -n "${POSTGRES_PASSWORD:-}" ]; then
  PASS_LEN=$(printf '%s' "$POSTGRES_PASSWORD" | wc -c | tr -d ' ')
fi

echo "migrate-and-seed: host=${HOST_NAME} port=${PORT_NUM} user=${USER_NAME} db=${DB_NAME} password_len=${PASS_LEN}"

if [ -z "${POSTGRES_PASSWORD:-}" ] && [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: POSTGRES_PASSWORD or DATABASE_URL is required" >&2
  exit 1
fi

if command -v psql >/dev/null 2>&1 && [ -n "${POSTGRES_PASSWORD:-}" ]; then
  echo "migrate-and-seed: preflight psql…"
  if ! PGPASSWORD="$POSTGRES_PASSWORD" psql \
    -h "$HOST_NAME" -p "$PORT_NUM" -U "$USER_NAME" -d "$DB_NAME" \
    -v ON_ERROR_STOP=1 -c 'SELECT 1' >/dev/null; then
    echo "ERROR: preflight DB auth failed (often 28P01)." >&2
    echo "HINT: POSTGRES_PASSWORD in Dokploy must match the role password stored in the Postgres volume (set at first init). Use ALTER USER … PASSWORD … or wipe the volume; avoid \$ in passwords (Compose interpolates)." >&2
    exit 1
  fi
fi

# Heal journal-less DBs (e.g. after a partial import) before migrate runs.
echo "migrate-and-seed: ensuring drizzle journal…"
set +e
node node_modules/tsx/dist/cli.mjs packages/database/src/baseline-journal.ts
baseline_ec=$?
set -e
if [ "$baseline_ec" -ne 0 ]; then
  echo "WARN: journal baseline exited ${baseline_ec}; continuing to migrate" >&2
fi

echo "migrate-and-seed: running migrations…"
set +e
node node_modules/tsx/dist/cli.mjs packages/database/src/migrate.ts
mig_ec=$?
set -e

if [ "$mig_ec" -ne 0 ]; then
  echo "ERROR: migrate failed (exit ${mig_ec})." >&2
  echo "HINT: If logs show password authentication failed → fix POSTGRES_PASSWORD vs volume." >&2
  echo "HINT: If logs show already exists / relation → DB has tables but missing drizzle journal (common after a bad import). Re-import a full dump or wipe the Postgres volume." >&2
  exit "$mig_ec"
fi

echo "migrate-and-seed: running seed (non-fatal)…"
set +e
node node_modules/tsx/dist/cli.mjs packages/database/src/seed.ts
seed_ec=$?
set -e

if [ "$seed_ec" -ne 0 ]; then
  echo "WARN: seed failed (exit ${seed_ec}, non-fatal); stack will still start" >&2
fi

echo "migrate-and-seed: done"
exit 0
