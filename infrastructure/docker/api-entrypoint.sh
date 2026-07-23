#!/bin/sh
# Prepare shared backup volume, then drop to the non-root app user.
# db-backup often creates dumps as root; without this, export/delete fail with EACCES.
set -eu

BACKUP_DIR="${BACKUP_DIR:-/backups}"
mkdir -p "$BACKUP_DIR"

if [ "$(id -u)" = "0" ]; then
  chown -R knowledgehub:knowledgehub "$BACKUP_DIR" || true
  exec setpriv --reuid=knowledgehub --regid=knowledgehub --init-groups -- "$@"
fi

exec "$@"
