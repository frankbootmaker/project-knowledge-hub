#!/bin/sh
# Same volume ownership fix as the API (backups + local blob fallback dirs).
set -eu

BACKUP_DIR="${BACKUP_DIR:-/backups}"
DATA_DIR="${DATA_DIR:-/data}"
mkdir -p "$BACKUP_DIR" \
  "$DATA_DIR/avatars" \
  "$DATA_DIR/media" \
  "$DATA_DIR/imports"

if [ "$(id -u)" = "0" ]; then
  chown -R knowledgehub:knowledgehub "$BACKUP_DIR" "$DATA_DIR" || true
  exec setpriv --reuid=knowledgehub --regid=knowledgehub --init-groups -- "$@"
fi

exec "$@"
