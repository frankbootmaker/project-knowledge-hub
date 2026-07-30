#!/usr/bin/env bash
# Long-running scheduler for Compose/Dokploy: dump when due, then wait.
# Intended entrypoint for the `db-backup` service (pg client image).
#
# Env (defaults when BACKUP_DIR/schedule.json is absent):
#   BACKUP_ENABLED=true|false     (default true)
#   BACKUP_INTERVAL_SECONDS=86400 (default 24h; min 60)
#   BACKUP_DIR=/backups
#   POSTGRES_HOST=postgres (+ POSTGRES_USER/DB/PASSWORD)
#   BACKUP_RUN_ON_START=1         (default 1 — dump once before first wait)
#   BACKUP_FAILURE_RETRY_SECONDS=900  (retry sooner after a failed dump)
#   BACKUP_SCHEDULER_POLL_SECONDS=60  (wake often so Admin schedule changes apply)
#
# Admin → Monitoring writes schedule.json (enabled + intervalSeconds). This loop
# re-reads that file every poll so enable/interval changes apply without restart.
# Dumps run as soon as they are overdue (catch-up), not only after a full sleep.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/db-ops-common.sh
source "${SCRIPT_DIR}/lib/db-ops-common.sh"

BACKUP_DIR="${BACKUP_DIR:-/backups}"
RUN_ON_START="${BACKUP_RUN_ON_START:-1}"
IDLE_POLL_SECONDS="${BACKUP_SCHEDULER_POLL_SECONDS:-60}"
FAILURE_RETRY_SECONDS="${BACKUP_FAILURE_RETRY_SECONDS:-900}"
HEARTBEAT_PATH="${BACKUP_DIR}/scheduler-heartbeat.json"

db_ops_fix_backup_perms "$BACKUP_DIR"

write_heartbeat() {
  local status="${1:-idle}"
  local next_due="${2:-}"
  local detail="${3:-}"
  mkdir -p "$BACKUP_DIR"
  local ts
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  {
    printf '{\n'
    printf '  "kind": "scheduler_heartbeat",\n'
    printf '  "at": %s,\n' "$(db_ops_json_str "$ts")"
    printf '  "status": %s,\n' "$(db_ops_json_str "$status")"
    printf '  "nextDueAt": %s,\n' "$(db_ops_json_str "$next_due")"
    printf '  "detail": %s,\n' "$(db_ops_json_str "$detail")"
    printf '  "hostname": %s\n' "$(db_ops_json_str "$(hostname 2>/dev/null || echo unknown)")"
    printf '}\n'
  } >"$HEARTBEAT_PATH"
}

# Seconds since last-success.json (empty if missing/unparseable).
seconds_since_last_success() {
  local stamp="${BACKUP_DIR}/last-success.json"
  if [[ ! -f "$stamp" ]]; then
    echo ""
    return 0
  fi
  local raw at epoch_now epoch_at
  raw="$(tr -d '\n' <"$stamp" 2>/dev/null || true)"
  at="$(printf '%s' "$raw" | sed -n 's/.*"at"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)"
  if [[ -z "$at" ]]; then
    echo ""
    return 0
  fi
  epoch_now="$(date -u +%s)"
  epoch_at="$(date -u -d "$at" +%s 2>/dev/null || true)"
  if [[ -z "$epoch_at" ]]; then
    echo ""
    return 0
  fi
  echo $((epoch_now - epoch_at))
}

iso_after_seconds() {
  local secs="${1:-0}"
  date -u -d "@$(($(date -u +%s) + secs))" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
    || date -u +%Y-%m-%dT%H:%M:%SZ
}

run_once() {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Starting scheduled backup…"
  write_heartbeat "running" "" "dump_in_progress"
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

# Sleep in short chunks so schedule.json changes (enable/interval) apply quickly.
interruptible_sleep() {
  local total="${1:-0}"
  local reason="${2:-waiting}"
  if [[ "$total" -le 0 ]]; then
    return 0
  fi
  local remaining="$total"
  local chunk
  local start_interval="$SCHEDULE_INTERVAL"
  while [[ "$remaining" -gt 0 ]]; do
    db_ops_load_schedule "$BACKUP_DIR"
    if [[ "$SCHEDULE_ENABLED" != "true" && "$SCHEDULE_ENABLED" != "1" ]]; then
      echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Schedule disabled during wait; waking early."
      return 1
    fi
    # Interval shortened while waiting — recompute from last success on next loop.
    if [[ "$SCHEDULE_INTERVAL" -lt "$start_interval" ]]; then
      echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Interval changed (${start_interval}s → ${SCHEDULE_INTERVAL}s); waking early."
      return 1
    fi
    chunk="$IDLE_POLL_SECONDS"
    if [[ "$chunk" -gt "$remaining" ]]; then
      chunk="$remaining"
    fi
    write_heartbeat "sleeping" "$(iso_after_seconds "$remaining")" \
      "${reason}; remaining=${remaining}s; interval=${SCHEDULE_INTERVAL}s; source=${SCHEDULE_SOURCE}"
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Waiting ${chunk}s (${remaining}s left; source=${SCHEDULE_SOURCE})"
    sleep "$chunk"
    remaining=$((remaining - chunk))
  done
  return 0
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
write_heartbeat "starting" "" "source=${SCHEDULE_SOURCE}"
LAST_ATTEMPT_FAILED=0
if [[ "$RUN_ON_START" == "1" ]]; then
  if [[ "$SCHEDULE_ENABLED" == "true" || "$SCHEDULE_ENABLED" == "1" ]]; then
    if run_once; then
      LAST_ATTEMPT_FAILED=0
    else
      LAST_ATTEMPT_FAILED=1
      echo "Initial backup failed; will retry after failure backoff." >&2
    fi
  else
    echo "Scheduled backups disabled (${SCHEDULE_SOURCE}); skipping run-on-start."
  fi
fi

while true; do
  db_ops_load_schedule "$BACKUP_DIR"
  if [[ "$SCHEDULE_ENABLED" != "true" && "$SCHEDULE_ENABLED" != "1" ]]; then
    write_heartbeat "disabled" "" "source=${SCHEDULE_SOURCE}"
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Backups disabled (${SCHEDULE_SOURCE}); polling every ${IDLE_POLL_SECONDS}s"
    sleep "$IDLE_POLL_SECONDS"
    LAST_ATTEMPT_FAILED=0
    continue
  fi

  local_age="$(seconds_since_last_success || true)"
  wait_seconds=0

  if [[ "$LAST_ATTEMPT_FAILED" == "1" ]]; then
    wait_seconds="$FAILURE_RETRY_SECONDS"
    if [[ "$wait_seconds" -gt "$SCHEDULE_INTERVAL" ]]; then
      wait_seconds="$SCHEDULE_INTERVAL"
    fi
    if [[ "$wait_seconds" -lt 60 ]]; then
      wait_seconds=60
    fi
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Previous dump failed; retrying in ${wait_seconds}s."
  elif [[ -z "$local_age" ]]; then
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] No last-success stamp; running catch-up dump."
    wait_seconds=0
  elif [[ "$local_age" -ge "$SCHEDULE_INTERVAL" ]]; then
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Last success ${local_age}s ago (≥ ${SCHEDULE_INTERVAL}s); running catch-up dump."
    wait_seconds=0
  else
    wait_seconds=$((SCHEDULE_INTERVAL - local_age))
  fi

  if [[ "$wait_seconds" -gt 0 ]]; then
    if ! interruptible_sleep "$wait_seconds" "until_next_due"; then
      continue
    fi
    # Re-evaluate after wait (catch-up / interval change / failure backoff).
    continue
  fi

  if run_once; then
    LAST_ATTEMPT_FAILED=0
  else
    LAST_ATTEMPT_FAILED=1
    echo "Scheduled backup failed; will retry after failure backoff." >&2
  fi
done
