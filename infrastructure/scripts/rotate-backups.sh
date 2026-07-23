#!/usr/bin/env bash
# Retention for knowledge-hub-*.dump artifacts under BACKUP_DIR.
# Policy (defaults): keep 7 daily, 4 weekly, 3 monthly; delete older.
# Admin → Monitoring may write BACKUP_DIR/retention.json (overrides env).
#
# Env:
#   BACKUP_DIR              (required; default ./backups from repo root when run from scripts)
#   BACKUP_KEEP_DAILY=7
#   BACKUP_KEEP_WEEKLY=4
#   BACKUP_KEEP_MONTHLY=3
#   BACKUP_FORCE_ROTATE=1   # run even when autoRotate is false
#   BACKUP_DRY_RUN=1        # print deletions only
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-${ROOT_DIR}/backups}"
KEEP_DAILY="${BACKUP_KEEP_DAILY:-7}"
KEEP_WEEKLY="${BACKUP_KEEP_WEEKLY:-4}"
KEEP_MONTHLY="${BACKUP_KEEP_MONTHLY:-3}"
AUTO_ROTATE=1
DRY_RUN="${BACKUP_DRY_RUN:-0}"

RETENTION_FILE="${BACKUP_DIR}/retention.json"
if [[ -f "$RETENTION_FILE" ]]; then
  if command -v python3 >/dev/null 2>&1; then
    eval "$(
      python3 - "$RETENTION_FILE" <<'PY'
import json, sys
path = sys.argv[1]
with open(path, encoding="utf-8") as fh:
    data = json.load(fh)
def n(key, default):
    try:
        return int(data.get(key, default))
    except (TypeError, ValueError):
        return default
auto = data.get("autoRotate", True)
print(f"KEEP_DAILY={n('keepDaily', 7)}")
print(f"KEEP_WEEKLY={n('keepWeekly', 4)}")
print(f"KEEP_MONTHLY={n('keepMonthly', 3)}")
print(f"AUTO_ROTATE={1 if auto else 0}")
PY
    )"
  else
    kd="$(grep -E '"keepDaily"' "$RETENTION_FILE" | head -1 | grep -Eo '[0-9]+' | head -1 || true)"
    kw="$(grep -E '"keepWeekly"' "$RETENTION_FILE" | head -1 | grep -Eo '[0-9]+' | head -1 || true)"
    km="$(grep -E '"keepMonthly"' "$RETENTION_FILE" | head -1 | grep -Eo '[0-9]+' | head -1 || true)"
    [[ -n "$kd" ]] && KEEP_DAILY="$kd"
    [[ -n "$kw" ]] && KEEP_WEEKLY="$kw"
    [[ -n "$km" ]] && KEEP_MONTHLY="$km"
    if grep -Eq '"autoRotate"[[:space:]]*:[[:space:]]*false' "$RETENTION_FILE"; then
      AUTO_ROTATE=0
    fi
  fi
fi

if [[ "${BACKUP_FORCE_ROTATE:-0}" != "1" && "$AUTO_ROTATE" != "1" ]]; then
  echo "Auto-rotate disabled (retention.json / policy); skipping."
  exit 0
fi

if [[ ! -d "$BACKUP_DIR" ]]; then
  echo "No backup dir: ${BACKUP_DIR}"
  exit 0
fi

shopt -s nullglob
mapfile -t FILES < <(
  find "$BACKUP_DIR" -maxdepth 1 -type f -name 'knowledge-hub-*.dump' -printf '%T@ %p\n' \
    2>/dev/null | sort -nr | awk '{print $2}'
)

if [[ ${#FILES[@]} -eq 0 ]]; then
  echo "No dumps to rotate in ${BACKUP_DIR}"
  exit 0
fi

now_epoch="$(date -u +%s)"
declare -A KEEP=()
declare -A SEEN_WEEK=()
declare -A SEEN_MONTH=()
weekly_count=0
monthly_count=0

for f in "${FILES[@]}"; do
  mtime="$(stat -c %Y "$f" 2>/dev/null || stat -f %m "$f")"
  age_days=$(( (now_epoch - mtime) / 86400 ))
  week_key="$(date -u -d "@${mtime}" +%G-W%V 2>/dev/null || date -u -r "$mtime" +%G-W%V)"
  month_key="$(date -u -d "@${mtime}" +%Y-%m 2>/dev/null || date -u -r "$mtime" +%Y-%m)"

  if (( age_days < KEEP_DAILY )); then
    KEEP["$f"]=1
    continue
  fi

  weekly_horizon=$((KEEP_DAILY + 7 * KEEP_WEEKLY))
  if (( age_days < weekly_horizon )); then
    if [[ -z "${SEEN_WEEK[$week_key]:-}" ]] && (( weekly_count < KEEP_WEEKLY )); then
      KEEP["$f"]=1
      SEEN_WEEK["$week_key"]=1
      weekly_count=$((weekly_count + 1))
    fi
    continue
  fi

  monthly_horizon=$((weekly_horizon + 31 * KEEP_MONTHLY))
  if (( age_days < monthly_horizon )); then
    if [[ -z "${SEEN_MONTH[$month_key]:-}" ]] && (( monthly_count < KEEP_MONTHLY )); then
      KEEP["$f"]=1
      SEEN_MONTH["$month_key"]=1
      monthly_count=$((monthly_count + 1))
    fi
    continue
  fi
done

deleted=0
kept=0
for f in "${FILES[@]}"; do
  if [[ -n "${KEEP[$f]:-}" ]]; then
    kept=$((kept + 1))
    continue
  fi
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "Would delete: $f"
  else
    echo "Deleting: $f"
    rm -f "$f"
  fi
  deleted=$((deleted + 1))
done

echo "Retention in ${BACKUP_DIR}: kept=${kept} deleted=${deleted} (daily<=${KEEP_DAILY}d, weekly=${KEEP_WEEKLY}, monthly=${KEEP_MONTHLY})"
