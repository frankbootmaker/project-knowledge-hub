#!/usr/bin/env bash
# Long-running scheduler for Compose/Dokploy: dump on an interval, then sleep.
# Intended entrypoint for the `db-backup` service (pg client image).
#
# Env (defaults when BACKUP_DIR/schedule.json is absent):
#   BACKUP_ENABLED=true|false     (default true)
#   BACKUP_INTERVAL_SECONDS=86400 (default 24h; min 60)
#   BACKUP_DIR=/backups
#   POSTGRES_HOST=postgres (+ POSTGRES_USER/DB/PASSWORD)
#   BACKUP_RUN_ON_START=1         (default 1 — dump once before first sleep)
#
# Admin → Monitoring writes schedule.json (enabled + intervalSeconds). This loop
# re-reads that file every cycle so changes apply without restarting the container.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/db-ops-common.sh
source "${SCRIPT_DIR}/lib/db-ops-common.sh"

BACKUP_DIR="${BACKUP_DIR:-/backups}"
RUN_ON_START="${BACKUP_RUN_ON_START:-1}"
IDLE_POLL_SECONDS=60

db_ops_fix_backup_perms "$BACKUP_DIR"

run_once() {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Starting scheduled backup…"
  if BACKUP_DIR="$BACKUP_DIR" BACKUP_RUN_ROTATE=1 \
    "${SCRIPT_DIR}/backup-db.sh"; then
    db_ops_fix_backup_perms "$BACKUP_DIR"
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Backup cycle done"
    return 0
  fi
  db_ops_stamp_write "${BACKUP_DIR}/last-failure.json" "backup_failure" "" "unknown"
  db_ops_fix_backup_perms "$BACKUP_DIR"
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Backup cycle failed" >&2
  return 1
}

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

db_ops_load_schedule "$BACKUP_DIR"
if [[ "$RUN_ON_START" == "1" ]]; then
  if [[ "$SCHEDULE_ENABLED" == "true" || "$SCHEDULE_ENABLED" == "1" ]]; then
    run_once || echo "Initial backup failed; will retry after interval." >&2
  else
    echo "Scheduled backups disabled (${SCHEDULE_SOURCE}); skipping run-on-start."
  fi
fi

while true; do
  db_ops_load_schedule "$BACKUP_DIR"
  if [[ "$SCHEDULE_ENABLED" != "true" && "$SCHEDULE_ENABLED" != "1" ]]; then
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Backups disabled (${SCHEDULE_SOURCE}); polling every ${IDLE_POLL_SECONDS}s"
    sleep "$IDLE_POLL_SECONDS"
    continue
  fi

  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Sleeping ${SCHEDULE_INTERVAL}s (source=${SCHEDULE_SOURCE})"
  sleep "$SCHEDULE_INTERVAL"

  # Re-read after sleep in case Admin disabled/changed the schedule mid-wait.
  db_ops_load_schedule "$BACKUP_DIR"
  if [[ "$SCHEDULE_ENABLED" != "true" && "$SCHEDULE_ENABLED" != "1" ]]; then
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Backups disabled during wait; skipping dump."
    continue
  fi

  run_once || echo "Scheduled backup failed; will retry after next interval." >&2
done
