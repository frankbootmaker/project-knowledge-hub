#!/bin/sh
# Prepare shared volumes, then drop to the non-root app user.
# db-backup often creates dumps as root; without this, export/delete fail with EACCES.
# Local blob fallbacks (avatars/media/imports) live under DATA_DIR when BlobStore is disabled.
set -eu

BACKUP_DIR="${BACKUP_DIR:-/backups}"
DATA_DIR="${DATA_DIR:-/data}"
# Chromium/Puppeteer (PDF export) needs a writable HOME/XDG after setpriv drops root.
# Without this, HOME stays /root and Chrome fails with chrome_crashpad_handler errors.
KH_HOME="${HOME_OVERRIDE:-/home/knowledgehub}"
XDG_CONFIG_HOME="${XDG_CONFIG_HOME:-/tmp/.chromium}"
XDG_CACHE_HOME="${XDG_CACHE_HOME:-/tmp/.chromium}"
mkdir -p "$BACKUP_DIR" \
  "$DATA_DIR/avatars" \
  "$DATA_DIR/media" \
  "$DATA_DIR/imports" \
  "$KH_HOME" \
  "$XDG_CONFIG_HOME" \
  "$XDG_CACHE_HOME"

if [ "$(id -u)" = "0" ]; then
  chown -R knowledgehub:knowledgehub "$BACKUP_DIR" "$DATA_DIR" "$KH_HOME" \
    "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME" || true
  export HOME="$KH_HOME"
  export XDG_CONFIG_HOME
  export XDG_CACHE_HOME
  exec setpriv --reuid=knowledgehub --regid=knowledgehub --init-groups -- "$@"
fi

export HOME="${HOME:-$KH_HOME}"
export XDG_CONFIG_HOME
export XDG_CACHE_HOME
exec "$@"
