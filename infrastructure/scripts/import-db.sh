#!/usr/bin/env bash
# Full-replace import of a pg_dump -Fc artifact (same or other KnowHub instance).
# v1 is replace/full restore — not merge. Requires CONFIRM_IMPORT=REPLACE.
#
# Examples:
#   CONFIRM_IMPORT=REPLACE DATABASE_URL=postgres://... \
#     ./infrastructure/scripts/import-db.sh ./backups/kh.dump
#   CONFIRM_IMPORT=REPLACE WIPE_DATABASE=1 POSTGRES_CONTAINER=... \
#     ./infrastructure/scripts/import-db.sh ./backups/kh.dump
#
# After import: run migrate (if dump schema behind app), re-apply target env secrets,
# update WEB_URL / MCP URLs, then smoke-test. See docs/deployment/OPERATIONS.md.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/db-ops-common.sh
source "${SCRIPT_DIR}/lib/db-ops-common.sh"

ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-${ROOT_DIR}/backups}"
STAMP_PATH="${IMPORT_STAMP_PATH:-${BACKUP_DIR}/last-import.json}"
DUMP="${1:-}"

if [[ -z "$DUMP" || ! -f "$DUMP" ]]; then
  echo "Usage: CONFIRM_IMPORT=REPLACE $0 <dump-file.dump>" >&2
  exit 1
fi

if [[ "${CONFIRM_IMPORT:-}" != "REPLACE" ]]; then
  echo "Refusing import: set CONFIRM_IMPORT=REPLACE (full replace, not merge)." >&2
  exit 1
fi

wipe_database() {
  local db="${POSTGRES_DB:-knowledge_hub}"
  local user="${POSTGRES_USER:-knowledge_hub}"
  echo "WIPE_DATABASE=1 — terminating sessions and recreating ${db}"
  local wipe_sql
  wipe_sql="$(cat <<SQL
SELECT pg_terminate_backend(pid) FROM pg_stat_activity
  WHERE datname = '${db}' AND pid <> pg_backend_pid();
DROP DATABASE IF EXISTS ${db};
CREATE DATABASE ${db} OWNER ${user};
SQL
)"
  if [[ -n "${POSTGRES_CONTAINER:-}" ]]; then
    docker exec -e PGPASSWORD="${POSTGRES_PASSWORD:-}" "$POSTGRES_CONTAINER" \
      psql -U "$user" -d postgres -v ON_ERROR_STOP=1 -c "$wipe_sql"
  elif [[ -n "${POSTGRES_HOST:-}" ]]; then
    PGPASSWORD="${POSTGRES_PASSWORD:-}" psql \
      -h "$POSTGRES_HOST" -p "${POSTGRES_PORT:-5432}" -U "$user" -d postgres \
      -v ON_ERROR_STOP=1 -c "$wipe_sql"
  elif [[ -n "${DATABASE_URL:-}" ]]; then
    # Connect to maintenance DB on same server
    local maint
    maint="$(echo "$DATABASE_URL" | sed -E 's#/[^/?]+(\?|$)#/postgres\1#')"
    psql "$maint" -v ON_ERROR_STOP=1 -c "$wipe_sql"
  else
    echo "WIPE_DATABASE requires POSTGRES_CONTAINER, POSTGRES_HOST, or DATABASE_URL." >&2
    exit 1
  fi
}

if [[ "${WIPE_DATABASE:-0}" == "1" ]]; then
  wipe_database
fi

echo "Importing ${DUMP} (pg_restore --clean --if-exists)…"

# Terminate other sessions so DROP/replace is not blocked by live API/worker pools.
if [[ -z "${SKIP_TERMINATE_SESSIONS:-}" ]]; then
  echo "Terminating other sessions on the target database…"
  term_sql="SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid();"
  if [[ -n "${POSTGRES_CONTAINER:-}" ]]; then
    docker exec -e PGPASSWORD="${POSTGRES_PASSWORD:-}" "$POSTGRES_CONTAINER" \
      psql -U "${POSTGRES_USER:-knowledge_hub}" -d "${POSTGRES_DB:-knowledge_hub}" \
      -v ON_ERROR_STOP=1 -c "$term_sql" || true
  elif [[ -n "${POSTGRES_HOST:-}" ]]; then
    PGPASSWORD="${POSTGRES_PASSWORD:-}" psql \
      -h "$POSTGRES_HOST" -p "${POSTGRES_PORT:-5432}" \
      -U "${POSTGRES_USER:-knowledge_hub}" -d "${POSTGRES_DB:-knowledge_hub}" \
      -v ON_ERROR_STOP=1 -c "$term_sql" || true
  elif [[ -n "${DATABASE_URL:-}" ]] && command -v psql >/dev/null 2>&1; then
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "$term_sql" || true
  fi
fi

"${SCRIPT_DIR}/restore-db.sh" "$DUMP"

SCHEMA_VERSION="$(db_ops_schema_version)"
db_ops_stamp_write "$STAMP_PATH" "import" "$(cd "$(dirname "$DUMP")" && pwd)/$(basename "$DUMP")" "$SCHEMA_VERSION"

echo "Import finished. Next: run migrate if needed, re-apply target secrets/WEB_URL, smoke login."
echo "Stamp: ${STAMP_PATH}"
