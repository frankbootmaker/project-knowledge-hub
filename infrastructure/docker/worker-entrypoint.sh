#!/bin/sh
# Same backup-volume ownership fix as the API (worker writes offsite stamps).
set -eu

BACKUP_DIR="${BACKUP_DIR:-/backups}"
mkdir -p "$BACKUP_DIR"

if [ "$(id -u)" = "0" ]; then
  chown -R knowledgehub:knowledgehub "$BACKUP_DIR" || true
  exec setpriv --reuid=knowledgehub --regid=knowledgehub --init-groups -- "$@"
fi

exec "$@"
