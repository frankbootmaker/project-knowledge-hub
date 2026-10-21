#!/usr/bin/env bash
# Retention for knowledge-hub-*.dump artifacts under BACKUP_DIR.
# Same policy as packages/blob-store/src/retention.ts:
#   daily: at most one dump per UTC day for keepDaily days, always plus the newest
#   then ≤keepWeekly one-per-ISO-week, then ≤keepMonthly one-per-month
# Admin → Monitoring may write BACKUP_DIR/retention.json (overrides env).
#
# Env:
#   BACKUP_DIR              (required; default ./backups from repo root when run from scripts)
#   BACKUP_KEEP_DAILY=7
#   BACKUP_KEEP_WEEKLY=4
#   BACKUP_KEEP_MONTHLY=3
#   BACKUP_FORCE_ROTATE=1   # run even when autoRotate is false
#   BACKUP_DRY_RUN=1        # print deletions only; does not write last-local-rotation.json
#   BACKUP_NOW_EPOCH        # optional unix seconds; pins the clock (tests). Default: date -u +%s
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/db-ops-common.sh
source "${SCRIPT_DIR}/lib/db-ops-common.sh"
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
if [[ "${BACKUP_NOW_EPOCH:-}" =~ ^[0-9]+$ ]]; then
  now_epoch="${BACKUP_NOW_EPOCH}"
fi

declare -A KEEP=()
declare -A SEEN_DAY=()
declare -A SEEN_WEEK=()
declare -A SEEN_MONTH=()
declare -a MTIMES=()
declare -a DAY_KEYS=()
declare -a WEEK_KEYS=()
declare -a MONTH_KEYS=()
daily_count=0
weekly_count=0
monthly_count=0

# One process for every dump. Per-file date(1)/stat(1) forks are slow enough
# under a loaded CI runner to blow the retention parity test's default timeout.
read_dump_meta() {
  local mtime day_key week_key month_key f meta_file
  if command -v python3 >/dev/null 2>&1; then
    meta_file="$(mktemp)"
    if ! python3 - "${FILES[@]}" >"$meta_file" <<'PY'
import os
import sys
from datetime import datetime, timezone

for path in sys.argv[1:]:
    mtime = int(os.stat(path).st_mtime)
    dt = datetime.fromtimestamp(mtime, timezone.utc)
    iso_year, iso_week, _iso_weekday = dt.isocalendar()
    sys.stdout.write(
        f"{mtime}\t{dt:%Y-%m-%d}\t{iso_year}-W{iso_week:02d}\t{dt:%Y-%m}\n"
    )
PY
    then
      rm -f "$meta_file"
      echo "Failed to read backup mtimes in ${BACKUP_DIR}" >&2
      exit 1
    fi
    while IFS=$'\t' read -r mtime day_key week_key month_key; do
      [[ -n "$mtime" ]] || continue
      MTIMES+=("$mtime")
      DAY_KEYS+=("$day_key")
      WEEK_KEYS+=("$week_key")
      MONTH_KEYS+=("$month_key")
    done <"$meta_file"
    rm -f "$meta_file"
    return 0
  fi

  for f in "${FILES[@]}"; do
    mtime="$(stat -c %Y "$f" 2>/dev/null || stat -f %m "$f")"
    day_key="$(date -u -d "@${mtime}" +%Y-%m-%d 2>/dev/null || date -u -r "$mtime" +%Y-%m-%d)"
    week_key="$(date -u -d "@${mtime}" +%G-W%V 2>/dev/null || date -u -r "$mtime" +%G-W%V)"
    month_key="$(date -u -d "@${mtime}" +%Y-%m 2>/dev/null || date -u -r "$mtime" +%Y-%m)"
    MTIMES+=("$mtime")
    DAY_KEYS+=("$day_key")
    WEEK_KEYS+=("$week_key")
    MONTH_KEYS+=("$month_key")
  done
}

read_dump_meta
if [[ ${#MTIMES[@]} -ne ${#FILES[@]} ]]; then
  echo "Failed to read backup mtimes in ${BACKUP_DIR}" >&2
  exit 1
fi

# Always keep the newest dump, even when it is older than the daily window.
KEEP["${FILES[0]}"]=1

for i in "${!FILES[@]}"; do
  f="${FILES[$i]}"
  mtime="${MTIMES[$i]}"
  age_days=$(( (now_epoch - mtime) / 86400 ))
  day_key="${DAY_KEYS[$i]}"
  week_key="${WEEK_KEYS[$i]}"
  month_key="${MONTH_KEYS[$i]}"

  if (( age_days < KEEP_DAILY )); then
    if [[ -z "${SEEN_DAY[$day_key]:-}" ]] && (( daily_count < KEEP_DAILY )); then
      KEEP["$f"]=1
      SEEN_DAY["$day_key"]=1
      daily_count=$((daily_count + 1))
    fi
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

echo "Retention in ${BACKUP_DIR}: kept=${kept} deleted=${deleted} (daily<=${KEEP_DAILY} one/day, weekly=${KEEP_WEEKLY}, monthly=${KEEP_MONTHLY}, dry_run=${DRY_RUN})"
if [[ "$DRY_RUN" != "1" ]]; then
  db_ops_rotation_stamp_write \
    "${BACKUP_DIR}/last-local-rotation.json" \
    "local_rotation" "$kept" "$deleted" ""
fi
