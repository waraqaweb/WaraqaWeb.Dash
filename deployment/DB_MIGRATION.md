# Database Migration (Local → DigitalOcean)

This is the safest way to upload your local MongoDB data (after you imported from the old dashboard) into the droplet’s Docker MongoDB without corrupting anything.

**Target DB name (from `docker-compose.yml`):** `online-class-manager`

---

## A) Safest method (backup on droplet, then restore)

### A1) On the droplet: create a backup file first
```bash
cd /opt/waraqa/app

# Make a timestamped backup on the droplet host
TS=$(date +%Y%m%d-%H%M%S)
mkdir -p /opt/waraqa/backups

docker compose exec -T mongo sh -lc \
  'mongodump --db online-class-manager --archive --gzip' \
  > "/opt/waraqa/backups/online-class-manager.$TS.archive.gz"

echo "Backup written: /opt/waraqa/backups/online-class-manager.$TS.archive.gz"
```

### A2) On your Windows PC: create a dump from your local MongoDB

If your local DB runs on default port:
```powershell
Set-Location -Path "C:\waraqa"

# Creates a single compressed archive file
mongodump --db online-class-manager --archive="C:\waraqa\online-class-manager.archive.gz" --gzip
```

If you need a URI:
```powershell
mongodump --uri "mongodb://127.0.0.1:27017/online-class-manager" --archive="C:\waraqa\online-class-manager.archive.gz" --gzip
```

### A3) Copy the archive to the droplet
```powershell
# Requires OpenSSH client in Windows
scp "C:\waraqa\online-class-manager.archive.gz" root@<DROPLET_IP>:/tmp/
```

### A4) Restore into the droplet’s Mongo container (replaces DB)
```bash
cd /opt/waraqa/app

# Get the mongo container id
MONGO_ID=$(docker compose ps -q mongo)

docker cp /tmp/online-class-manager.archive.gz "$MONGO_ID:/tmp/online-class-manager.archive.gz"

docker exec -i "$MONGO_ID" sh -lc \
  'mongorestore --nsInclude "online-class-manager.*" --drop --archive=/tmp/online-class-manager.archive.gz --gzip'

# Optional: delete archive from container
docker exec -i "$MONGO_ID" rm -f /tmp/online-class-manager.archive.gz
```

### A5) Restart backend and confirm
```bash
cd /opt/waraqa/app

docker compose restart backend marketing web

docker compose logs -n 80 backend
```

---

## B) Fast method (pipe dump over SSH, no intermediate files)

Run from your Windows PC (PowerShell). This requires:
- `mongodump` installed locally
- SSH access to the droplet

```powershell
mongodump --db online-class-manager --archive --gzip `
  | ssh root@<DROPLET_IP> "cd /opt/waraqa/app; MONGO_ID=$(docker compose ps -q mongo); docker exec -i $MONGO_ID mongorestore --archive --gzip --drop --nsInclude 'online-class-manager.*'"
```

If this is hard to run on Windows quoting, use method A instead.

---

## Notes / safety

- `--drop` deletes collections before restoring: this ensures the droplet DB matches your local DB exactly.
- If you only want to restore a subset, remove `--drop` and/or use different `--nsInclude` filters.
- If you ever suspect a bad restore, rollback by restoring the droplet backup created in A1.
