#!/usr/bin/env bash
# Thin pg_restore wrapper for Dokploy Dev/UAT Postgres.
# Prefer import-db.sh for operator imports (CONFIRM_IMPORT + stamp).
#
# WARNING: restores into the target database; prefer WIPE_DATABASE=1 via import-db.sh
# for disaster recovery / cross-instance replace.
#
# Examples:
#   DATABASE_URL=postgres://... ./infrastructure/scripts/restore-db.sh ./backups/kh.dump
#   POSTGRES_CONTAINER=... ./infrastructure/scripts/restore-db.sh ./backups/kh.dump
#   POSTGRES_HOST=postgres POSTGRES_PASSWORD=... ./infrastructure/scripts/restore-db.sh ./backups/kh.dump
set -euo pipefail

DUMP="${1:-}"
if [[ -z "$DUMP" || ! -f "$DUMP" ]]; then
  echo "Usage: $0 <dump-file.dump>" >&2
  exit 1
fi

restore_via_container() {
  local db="${POSTGRES_DB:-knowledge_hub}"
  local user="${POSTGRES_USER:-knowledge_hub}"
  echo "Restoring ${DUMP} → container ${POSTGRES_CONTAINER} (${db})"
  docker exec -i -e PGPASSWORD="${POSTGRES_PASSWORD:-}" "$POSTGRES_CONTAINER" \
    pg_restore -U "$user" -d "$db" --clean --if-exists --no-owner --no-acl \
    <"$DUMP"
}

restore_via_host() {
  local db="${POSTGRES_DB:-knowledge_hub}"
  local user="${POSTGRES_USER:-knowledge_hub}"
  echo "Restoring ${DUMP} → ${POSTGRES_HOST}:${POSTGRES_PORT:-5432}/${db}"
  PGPASSWORD="${POSTGRES_PASSWORD:-}" pg_restore \
    -h "$POSTGRES_HOST" -p "${POSTGRES_PORT:-5432}" -U "$user" -d "$db" \
    --clean --if-exists --no-owner --no-acl \
    "$DUMP"
}

restore_via_url() {
  if ! command -v pg_restore >/dev/null 2>&1; then
    echo "pg_restore not found on PATH. Install client tools or use POSTGRES_CONTAINER / POSTGRES_HOST." >&2
    exit 1
  fi
  echo "Restoring ${DUMP} → DATABASE_URL"
  pg_restore -d "$DATABASE_URL" --clean --if-exists --no-owner --no-acl "$DUMP"
}

if [[ -n "${POSTGRES_CONTAINER:-}" ]]; then
  restore_via_container
elif [[ -n "${POSTGRES_HOST:-}" ]]; then
  restore_via_host
elif [[ -n "${DATABASE_URL:-}" ]]; then
  restore_via_url
else
  echo "Set DATABASE_URL, POSTGRES_HOST (+ POSTGRES_*), or POSTGRES_CONTAINER (+ POSTGRES_*)." >&2
  exit 1
fi

echo "Restore finished"
