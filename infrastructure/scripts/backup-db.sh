#!/usr/bin/env bash
# Thin pg_dump wrapper for Dokploy Dev/UAT Postgres.
# Prefer running against the postgres service on the Compose network.
#
# Examples:
#   DATABASE_URL=postgres://... ./infrastructure/scripts/backup-db.sh
#   ./infrastructure/scripts/backup-db.sh ./backups/kh-$(date +%Y%m%d).dump
#   POSTGRES_CONTAINER=knowledge-hub-dokploy-postgres-1 ./infrastructure/scripts/backup-db.sh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="${1:-$ROOT_DIR/backups/knowledge-hub-$(date -u +%Y%m%dT%H%M%SZ).dump}"
mkdir -p "$(dirname "$OUT")"

if [[ -n "${POSTGRES_CONTAINER:-}" ]]; then
  DB="${POSTGRES_DB:-knowledge_hub}"
  USER="${POSTGRES_USER:-knowledge_hub}"
  echo "Dumping from container ${POSTGRES_CONTAINER} → ${OUT}"
  docker exec -e PGPASSWORD="${POSTGRES_PASSWORD:-}" "$POSTGRES_CONTAINER" \
    pg_dump -U "$USER" -d "$DB" -Fc --no-owner --no-acl \
    >"$OUT"
  echo "Wrote ${OUT}"
  exit 0
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "Set DATABASE_URL or POSTGRES_CONTAINER (+ POSTGRES_* )" >&2
  exit 1
fi

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "pg_dump not found on PATH. Install client tools or use POSTGRES_CONTAINER=..." >&2
  exit 1
fi

echo "Dumping DATABASE_URL → ${OUT}"
pg_dump "$DATABASE_URL" -Fc --no-owner --no-acl >"$OUT"
echo "Wrote ${OUT}"
