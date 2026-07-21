#!/usr/bin/env bash
# Thin pg_restore wrapper for Dokploy Dev/UAT Postgres.
# WARNING: restores into the target database; prefer a fresh volume for disaster recovery drills.
#
# Examples:
#   DATABASE_URL=postgres://... ./infrastructure/scripts/restore-db.sh ./backups/kh.dump
#   POSTGRES_CONTAINER=... ./infrastructure/scripts/restore-db.sh ./backups/kh.dump
set -euo pipefail

DUMP="${1:-}"
if [[ -z "$DUMP" || ! -f "$DUMP" ]]; then
  echo "Usage: $0 <dump-file.dump>" >&2
  exit 1
fi

if [[ -n "${POSTGRES_CONTAINER:-}" ]]; then
  DB="${POSTGRES_DB:-knowledge_hub}"
  USER="${POSTGRES_USER:-knowledge_hub}"
  echo "Restoring ${DUMP} → container ${POSTGRES_CONTAINER} (${DB})"
  docker exec -i -e PGPASSWORD="${POSTGRES_PASSWORD:-}" "$POSTGRES_CONTAINER" \
    pg_restore -U "$USER" -d "$DB" --clean --if-exists --no-owner --no-acl \
    <"$DUMP"
  echo "Restore finished"
  exit 0
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "Set DATABASE_URL or POSTGRES_CONTAINER (+ POSTGRES_* )" >&2
  exit 1
fi

if ! command -v pg_restore >/dev/null 2>&1; then
  echo "pg_restore not found on PATH. Install client tools or use POSTGRES_CONTAINER=..." >&2
  exit 1
fi

echo "Restoring ${DUMP} → DATABASE_URL"
pg_restore -d "$DATABASE_URL" --clean --if-exists --no-owner --no-acl "$DUMP"
echo "Restore finished"
