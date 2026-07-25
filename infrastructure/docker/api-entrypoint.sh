#!/bin/sh
# Prepare shared volumes, then drop to the non-root app user.
# db-backup often creates dumps as root; without this, export/delete fail with EACCES.
# Local blob fallbacks (avatars/media/imports) live under DATA_DIR when BlobStore is disabled.
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
