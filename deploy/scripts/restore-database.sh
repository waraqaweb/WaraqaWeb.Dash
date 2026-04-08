#!/usr/bin/env bash
set -euo pipefail
#
# restore-database.sh — restore from a backup-database.sh dump
# ──────────────────
# Usage:
#   bash deploy/scripts/restore-database.sh /opt/waraqa-backups/2026-04-08T12-00-00Z
#
# ⚠  This DROP-REPLACES existing collections. Only use for rollback.
#

BACKUP_DIR="${1:-}"
if [ -z "$BACKUP_DIR" ]; then
  echo "Usage: $0 <backup-directory>"
  echo "Available backups:"
  ls -1d /opt/waraqa-backups/*/ 2>/dev/null || echo "  (none found)"
  exit 1
fi

if [ ! -d "$BACKUP_DIR" ]; then
  echo "ERROR: $BACKUP_DIR does not exist"
  exit 1
fi

echo "╔═══════════════════════════════════════════════╗"
echo "║  DATABASE RESTORE — THIS IS DESTRUCTIVE       ║"
echo "╚═══════════════════════════════════════════════╝"
echo ""
echo "  Source: $BACKUP_DIR"
echo ""
echo "This will DROP and replace all existing collections."
echo "Press Ctrl+C within 10 seconds to abort..."
echo ""

for i in $(seq 10 -1 1); do
  printf "\r  Restoring in %d... " "$i"
  sleep 1
done
echo ""

if docker compose ps mongo --format '{{.Name}}' 2>/dev/null | grep -q mongo; then
  echo "[restore] Using docker exec into mongo container"
  docker compose cp "$BACKUP_DIR/." mongo:/tmp/mongodump-restore 2>&1
  docker compose exec -T mongo mongorestore --drop /tmp/mongodump-restore 2>&1
  docker compose exec -T mongo rm -rf /tmp/mongodump-restore 2>/dev/null || true
else
  MONGO_URI="${MONGODB_URI:-mongodb://localhost:27017/waraqadb}"
  echo "[restore] Using local mongorestore with $MONGO_URI"
  mongorestore --uri="$MONGO_URI" --drop "$BACKUP_DIR" 2>&1
fi

echo ""
echo "[restore] ✓ Database restored from $BACKUP_DIR"
echo "[restore]   Restart backend to pick up changes: docker compose restart backend"
