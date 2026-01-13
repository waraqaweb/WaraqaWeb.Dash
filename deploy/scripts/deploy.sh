#!/usr/bin/env bash
set -euo pipefail

# Waraqa droplet deploy script
# - Fast: rebuild only changed services
# - Safe: uses hard reset to origin/main
# - Works with GitHub Actions ssh-action or manual SSH

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

lock_acquire() {
  # Prevent concurrent deploys (and auto-heal stale locks).
  # Uses an atomic mkdir, then writes PID metadata.
  local lock_dir="/tmp/waraqa-deploy.lock"
  local pid_file="$lock_dir/pid"
  local meta_file="$lock_dir/meta"

  if mkdir "$lock_dir" 2>/dev/null; then
    echo "$$" > "$pid_file" 2>/dev/null || true
    {
      echo "pid=$$"
      echo "started_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
      echo "host=$(hostname)"
      echo "user=$(id -un 2>/dev/null || true)"
      echo "cwd=$PWD"
    } > "$meta_file" 2>/dev/null || true
    trap 'rm -rf "$lock_dir"' EXIT
    return 0
  fi

  # Lock exists. If it's stale (PID not running), clear and retry once.
  if [[ -f "$pid_file" ]]; then
    local existing_pid
    existing_pid="$(cat "$pid_file" 2>/dev/null || true)"
    if [[ "$existing_pid" =~ ^[0-9]+$ ]]; then
      if ! kill -0 "$existing_pid" 2>/dev/null; then
        echo "[deploy] WARNING: Found stale deploy lock (pid=$existing_pid). Removing it..."
        rm -rf "$lock_dir" 2>/dev/null || true
        if mkdir "$lock_dir" 2>/dev/null; then
          echo "$$" > "$pid_file" 2>/dev/null || true
          {
            echo "pid=$$"
            echo "started_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
            echo "host=$(hostname)"
            echo "user=$(id -un 2>/dev/null || true)"
            echo "cwd=$PWD"
          } > "$meta_file" 2>/dev/null || true
          trap 'rm -rf "$lock_dir"' EXIT
          return 0
        fi
      fi
    fi
  fi

  # Lock exists but has no PID metadata. This usually means the lock was created
  # by an older version of this script (or manually) and may be stale.
  echo "[deploy] ERROR: Another deploy appears to be running ($lock_dir exists)."
  echo "[deploy] NOTE: Lock has no pid/meta files; it may be stale from an older deploy script." 
  echo "[deploy] If you are sure no deploy is running, remove it: rm -rf $lock_dir"
  echo "[deploy] To check for a running deploy: ps aux | grep -E 'deploy\.sh|docker compose' | grep -v grep"
  exit 1
}

lock_acquire

# Force a stable Compose project name so volumes/networks remain consistent.
# This prevents accidental "missing data" when running compose from a different folder.
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-waraqa}"
COMPOSE_BASE=(docker compose -p "$COMPOSE_PROJECT_NAME")
COMPOSE_GHCR=(docker compose -p "$COMPOSE_PROJECT_NAME" -f docker-compose.yml -f docker-compose.ghcr.yml)

MODE="${1:-auto}"  # auto | all | no-build | pull

export DOCKER_BUILDKIT=1
export COMPOSE_DOCKER_CLI_BUILD=1
export BUILDX_NO_DEFAULT_ATTESTATIONS=1
export BUILDKIT_PROGRESS=plain

PREV_FILE="${ROOT_DIR}/.previous_deploy_sha"

# Record rollback point BEFORE updating code
OLD_SHA="$(git rev-parse HEAD)"

echo "[deploy] repo: $ROOT_DIR"
echo "[deploy] mode: $MODE"
echo "[deploy] old:  $OLD_SHA"

git fetch origin main
# Hard reset keeps the droplet in a clean, reproducible state
# (avoids merge conflicts and half-applied changes)
git reset --hard origin/main

git rev-parse HEAD > "$PREV_FILE"
NEW_SHA="$(git rev-parse HEAD)"

# Surface the deployed version inside running containers (used by /api/health).
export APP_VERSION="${APP_VERSION:-$NEW_SHA}"
# BUILD_VERSION is intended to be a simple increasing number.
# - In CI/CD you should pass BUILD_VERSION explicitly (e.g. GitHub run_number).
# - For manual SSH deploys, we auto-increment a local counter file.
if [[ -z "${BUILD_VERSION:-}" ]]; then
  COUNTER_FILE="${ROOT_DIR}/.deploy_version"
  LAST=""
  if [[ -f "$COUNTER_FILE" ]]; then
    LAST="$(cat "$COUNTER_FILE" 2>/dev/null || true)"
  fi

  if [[ "$LAST" =~ ^[0-9]+$ ]]; then
    BUILD_VERSION="$((LAST + 1))"
  else
    BUILD_VERSION="1"
  fi

  echo "$BUILD_VERSION" > "$COUNTER_FILE" 2>/dev/null || true
  export BUILD_VERSION
fi
# BUILD_TIME is shown in Settings; keep it human-readable.
export BUILD_TIME="${BUILD_TIME:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"

# Compute changed paths between previous and new SHA
CHANGED="$(git diff --name-only "$OLD_SHA" "$NEW_SHA" || true)"

SERVICES=""
if printf "%s\n" "$CHANGED" | grep -qE '^(deploy/nginx/|docker-compose\.yml)'; then SERVICES="$SERVICES nginx"; fi
if printf "%s\n" "$CHANGED" | grep -qE '^(backend/|deploy/backend/|backend/server\.js|backend/routes/)'; then SERVICES="$SERVICES backend"; fi
if printf "%s\n" "$CHANGED" | grep -qE '^(frontend/|deploy/frontend/)'; then SERVICES="$SERVICES frontend"; fi

# Trim whitespace
SERVICES_TRIMMED="$(printf "%s" "$SERVICES" | tr -d ' ' || true)"

compose() {
  if [[ "$MODE" == "pull" ]]; then
    "${COMPOSE_GHCR[@]}" "$@"
  else
    "${COMPOSE_BASE[@]}" "$@"
  fi
}

# Validate compose config renders correctly (catches env/template mistakes)
compose config -q

if [[ "$MODE" == "all" ]]; then
  echo "[deploy] Rebuilding ALL services"
  compose up -d --build
elif [[ "$MODE" == "pull" ]]; then
  echo "[deploy] Pulling prebuilt images (GHCR)"
  compose pull
  # Force-recreate so updated env (APP_VERSION/BUILD_TIME) and new image digests
  # are definitely applied even when tags stay the same (e.g. :main).
  compose up -d --force-recreate --remove-orphans
elif [[ "$MODE" == "no-build" ]]; then
  echo "[deploy] No build; restarting containers"
  compose up -d
elif [[ -n "$SERVICES_TRIMMED" ]]; then
  echo "[deploy] Rebuilding services:$SERVICES"
  if printf "%s\n" "$SERVICES" | grep -q "frontend"; then
    echo "[deploy] NOTE: frontend rebuilds can take several minutes on small droplets (Vite + npm ci)."
  fi
  compose up -d --build $SERVICES
else
  echo "[deploy] No build needed; restarting containers"
  compose up -d
fi

compose ps

# Avoid "Login failed" right after deploy by waiting until backend is ready.
echo "[deploy] Waiting for backend to be healthy (up to ~180s)..."
healthy="0"
for i in $(seq 1 90); do
  if compose exec -T backend node -e "const http=require('http');const req=http.get('http://127.0.0.1:5000/api/health',r=>process.exit(r.statusCode===200?0:1));req.on('error',()=>process.exit(1));" >/dev/null 2>&1; then
    healthy="1"
    break
  fi
  sleep 2
done

if [[ "$healthy" != "1" ]]; then
  echo "[deploy] ERROR: backend did not become healthy. Showing latest logs..."
  compose logs --tail=200 backend || true
  compose logs --tail=200 nginx || true
  echo "[deploy] Rollback with: git reset --hard $OLD_SHA ; docker compose up -d --build"
  exit 1
fi

# IMPORTANT: nginx can keep stale upstream IPs after backend/frontend containers are recreated.
echo "[deploy] Reloading nginx to refresh upstream DNS..."
compose exec -T nginx nginx -s reload >/dev/null 2>&1 || compose restart nginx

echo "[deploy] Verifying nginx can reach backend + frontend..."
if ! compose exec -T nginx sh -lc "wget -q -O- http://backend:5000/api/health >/dev/null" >/dev/null 2>&1; then
  echo "[deploy] ERROR: nginx -> backend failed. Showing latest logs + nginx config..."
  compose exec -T nginx nginx -T || true
  compose logs --tail=200 nginx || true
  compose logs --tail=200 backend || true
  echo "[deploy] Rollback with: git reset --hard $OLD_SHA ; docker compose up -d --build"
  exit 1
fi

if ! compose exec -T nginx sh -lc "wget -q --spider http://frontend:80/dashboard/ >/dev/null" >/dev/null 2>&1; then
  echo "[deploy] ERROR: nginx -> frontend failed. Showing latest logs + nginx config..."
  compose exec -T nginx nginx -T || true
  compose logs --tail=200 nginx || true
  compose logs --tail=200 frontend || true
  echo "[deploy] Rollback with: git reset --hard $OLD_SHA ; docker compose up -d --build"
  exit 1
fi

# Non-destructive checks for critical volumes (helps catch accidental volume/name mismatches)
echo "[deploy] Checking mongo volume (should NOT be empty)..."
compose exec -T mongo sh -lc 'du -sh /data/db || true; ls -lah /data/db | head -n 50 || true'

echo "[deploy] Checking library storage mounts..."
compose exec -T backend sh -lc '
  echo "LIBRARY_LOCAL_ASSET_DIR=${LIBRARY_LOCAL_ASSET_DIR:-}";
  test "${LIBRARY_LOCAL_ASSET_DIR:-}" = "/data/library-assets" || { echo "ERROR: LIBRARY_LOCAL_ASSET_DIR must be /data/library-assets"; exit 1; };
  mkdir -p "${LIBRARY_LOCAL_ASSET_DIR}";
  touch "${LIBRARY_LOCAL_ASSET_DIR}/.write_test";
  rm -f "${LIBRARY_LOCAL_ASSET_DIR}/.write_test";
  du -sh "/data/library-assets" || true;
  du -sh "/data/library-uploads" || true;
'

echo "[deploy] done: $NEW_SHA"