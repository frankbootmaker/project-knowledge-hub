#!/usr/bin/env bash
# Alias for backup-db.sh — explicit “export” naming for operators / docs.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "${SCRIPT_DIR}/backup-db.sh" "$@"
