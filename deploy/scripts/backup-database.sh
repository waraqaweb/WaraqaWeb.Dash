#!/usr/bin/env bash
set -euo pipefail
#
# backup-database.sh — mongodump to timestamped directory
# ──────────────────
# Run locally or on the droplet before any migration.
#
# Usage (local):
#   MONGODB_URI="mongodb://localhost:27017/waraqadb" bash deploy/scripts/backup-database.sh
#
# Usage (droplet via docker exec):
#   ssh root@your-server "cd /opt/waraqa && bash deploy/scripts/backup-database.sh"
#
# The script:
#   1. Dumps the database to /opt/waraqa-backups/YYYY-MM-DDTHH-MM-SS/
#   2. Verifies the dump produced files
#   3. Prints the backup path for scripted consumption
#

BACKUP_ROOT="${BACKUP_ROOT:-/opt/waraqa-backups}"
TIMESTAMP="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
BACKUP_DIR="${BACKUP_ROOT}/${TIMESTAMP}"

MONGO_URI="${MONGODB_URI:-}"

# If running inside docker host, try to exec into the mongo container
if [ -z "$MONGO_URI" ]; then
  # Check if we're on the droplet (has docker compose mongo service)
  if docker compose ps mongo --format '{{.Name}}' 2>/dev/null | grep -q mongo; then
    echo "[backup] Using docker exec into mongo container"
    mkdir -p "$BACKUP_DIR"
    docker compose exec -T mongo mongodump --out /tmp/mongodump-export 2>&1
    docker compose cp mongo:/tmp/mongodump-export/. "$BACKUP_DIR/" 2>&1
    docker compose exec -T mongo rm -rf /tmp/mongodump-export 2>/dev/null || true
  else
    # Try local mongodump with default URI
    MONGO_URI="mongodb://localhost:27017/waraqadb"
    echo "[backup] Using local mongodump with $MONGO_URI"
    mkdir -p "$BACKUP_DIR"
    mongodump --uri="$MONGO_URI" --out="$BACKUP_DIR" 2>&1
  fi
else
  echo "[backup] Using MONGODB_URI from env"
  mkdir -p "$BACKUP_DIR"
  mongodump --uri="$MONGO_URI" --out="$BACKUP_DIR" 2>&1
fi

# Verify
FILE_COUNT=$(find "$BACKUP_DIR" -type f | wc -l)
if [ "$FILE_COUNT" -lt 1 ]; then
  echo "[backup] ERROR: Backup directory is empty! Aborting."
  exit 1
fi

SIZE=$(du -sh "$BACKUP_DIR" | cut -f1)
echo ""
echo "[backup] ✓ Database backed up successfully"
echo "[backup]   Path:  $BACKUP_DIR"
echo "[backup]   Files: $FILE_COUNT"
echo "[backup]   Size:  $SIZE"
echo ""
echo "BACKUP_PATH=$BACKUP_DIR"
