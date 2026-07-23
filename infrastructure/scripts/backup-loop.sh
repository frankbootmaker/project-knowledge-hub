#!/usr/bin/env bash
# Long-running scheduler for Compose/Dokploy: dump on an interval, then sleep.
# Intended entrypoint for the `db-backup` service (pg client image).
#
# Env:
#   BACKUP_ENABLED=true|false     (default true)
#   BACKUP_INTERVAL_SECONDS=86400 (default 24h; min 60)
#   BACKUP_DIR=/backups
#   POSTGRES_HOST=postgres (+ POSTGRES_USER/DB/PASSWORD)
#   BACKUP_RUN_ON_START=1         (default 1 — dump once before first sleep)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/db-ops-common.sh
source "${SCRIPT_DIR}/lib/db-ops-common.sh"

BACKUP_DIR="${BACKUP_DIR:-/backups}"
INTERVAL="${BACKUP_INTERVAL_SECONDS:-86400}"
ENABLED="${BACKUP_ENABLED:-true}"
RUN_ON_START="${BACKUP_RUN_ON_START:-1}"

if [[ "$INTERVAL" -lt 60 ]]; then
  echo "BACKUP_INTERVAL_SECONDS must be >= 60 (got ${INTERVAL})" >&2
  exit 1
fi

db_ops_fix_backup_perms "$BACKUP_DIR"

run_once() {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Starting scheduled backup…"
  BACKUP_DIR="$BACKUP_DIR" BACKUP_RUN_ROTATE=1 \
    "${SCRIPT_DIR}/backup-db.sh"
  db_ops_fix_backup_perms "$BACKUP_DIR"
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Backup cycle done; sleeping ${INTERVAL}s"
}

if [[ "$ENABLED" != "true" && "$ENABLED" != "1" ]]; then
  echo "BACKUP_ENABLED=${ENABLED} — idle loop (no dumps)."
  while true; do sleep 3600; done
fi

if [[ -z "${POSTGRES_HOST:-}" && -z "${POSTGRES_CONTAINER:-}" && -z "${DATABASE_URL:-}" ]]; then
  export POSTGRES_HOST="${POSTGRES_HOST:-postgres}"
fi

# Wait for Postgres readiness
if [[ -n "${POSTGRES_HOST:-}" ]]; then
  echo "Waiting for Postgres at ${POSTGRES_HOST}:${POSTGRES_PORT:-5432}…"
  for _ in $(seq 1 60); do
    if PGPASSWORD="${POSTGRES_PASSWORD:-}" pg_isready \
      -h "$POSTGRES_HOST" -p "${POSTGRES_PORT:-5432}" \
      -U "${POSTGRES_USER:-knowledge_hub}" >/dev/null 2>&1; then
      break
    fi
    sleep 2
  done
fi

if [[ "$RUN_ON_START" == "1" ]]; then
  run_once || echo "Initial backup failed; will retry after interval." >&2
fi

while true; do
  sleep "$INTERVAL"
  run_once || echo "Scheduled backup failed; will retry after next interval." >&2
done
