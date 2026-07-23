#!/usr/bin/env bash
# Emergency: wipe + restore a dump into Compose/Dokploy Postgres (fixes "site down after import").
#
# Run inside the `db-backup` container (has /backups + /scripts + network to postgres),
# or from any host with POSTGRES_* and the dump path.
#
# Dokploy → db-backup → Execute / Terminal:
#   ls -lt /backups/*.dump
#   CONFIRM_IMPORT=REPLACE WIPE_DATABASE=1 \
#     POSTGRES_PASSWORD='…' \
#     /scripts/dokploy-recover-db.sh /backups/knowledge-hub-YYYYMMDD….dump
#
# Then Redeploy (or restart) so migrate → api → web start cleanly.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DUMP="${1:-}"

if [[ -z "$DUMP" || ! -f "$DUMP" ]]; then
  echo "Usage: CONFIRM_IMPORT=REPLACE WIPE_DATABASE=1 $0 <dump-file.dump>" >&2
  echo "Available dumps:" >&2
  ls -lt "${BACKUP_DIR:-/backups}"/knowledge-hub-*.dump 2>/dev/null || true
  exit 1
fi

if [[ "${CONFIRM_IMPORT:-}" != "REPLACE" ]]; then
  echo "Refusing: set CONFIRM_IMPORT=REPLACE" >&2
  exit 1
fi

export BACKUP_DIR="${BACKUP_DIR:-/backups}"
export POSTGRES_HOST="${POSTGRES_HOST:-postgres}"
export POSTGRES_PORT="${POSTGRES_PORT:-5432}"
export POSTGRES_DB="${POSTGRES_DB:-knowledge_hub}"
export POSTGRES_USER="${POSTGRES_USER:-knowledge_hub}"

if [[ -z "${POSTGRES_PASSWORD:-}" ]]; then
  echo "Set POSTGRES_PASSWORD (same value as the Compose/Dokploy postgres service)." >&2
  exit 1
fi

export WIPE_DATABASE="${WIPE_DATABASE:-1}"
export CONFIRM_IMPORT=REPLACE

echo "=== Recover DB from ${DUMP} (wipe=${WIPE_DATABASE}) ==="
"${SCRIPT_DIR}/import-db.sh" "$DUMP"

echo
echo "=== Next ==="
echo "1. In Dokploy: Redeploy or Restart the Compose project (migrate must succeed)."
echo "2. Confirm api + web are healthy."
echo "3. Log in with users from the restored dump."
echo "4. If migrate still fails, check migrate logs — then try an older dump from ${BACKUP_DIR}."
