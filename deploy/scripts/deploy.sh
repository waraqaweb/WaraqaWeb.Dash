#!/usr/bin/env bash
set -euo pipefail

# Waraqa droplet deploy script
# - Fast: rebuild only changed services
# - Safe: uses hard reset to origin/main
# - Works with GitHub Actions ssh-action or manual SSH

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

MODE="${1:-auto}"  # auto | all | no-build | pull

export DOCKER_BUILDKIT=1
export COMPOSE_DOCKER_CLI_BUILD=1
export BUILDX_NO_DEFAULT_ATTESTATIONS=1
export BUILDKIT_PROGRESS=plain

PREV_FILE="${ROOT_DIR}/.previous_deploy_sha"
OLD_SHA=""
if [[ -f "$PREV_FILE" ]]; then
  OLD_SHA="$(cat "$PREV_FILE" 2>/dev/null || true)"
fi

# Record current HEAD before updating (fallback if prev file missing)
CURRENT_SHA="$(git rev-parse HEAD)"
if [[ -z "$OLD_SHA" ]]; then
  OLD_SHA="$CURRENT_SHA"
fi

echo "[deploy] repo: $ROOT_DIR"
echo "[deploy] mode: $MODE"
echo "[deploy] old:  $OLD_SHA"

git fetch origin main
# Hard reset keeps the droplet in a clean, reproducible state
# (avoids merge conflicts and half-applied changes)
git reset --hard origin/main

git rev-parse HEAD > "$PREV_FILE"
NEW_SHA="$(git rev-parse HEAD)"

# Compute changed paths between previous and new SHA
CHANGED="$(git diff --name-only "$OLD_SHA" "$NEW_SHA" || true)"

SERVICES=""
if printf "%s\n" "$CHANGED" | grep -qE '^(deploy/nginx/|docker-compose\.yml)'; then SERVICES="$SERVICES nginx"; fi
if printf "%s\n" "$CHANGED" | grep -qE '^(backend/|deploy/backend/|backend/server\.js|backend/routes/)'; then SERVICES="$SERVICES backend"; fi
if printf "%s\n" "$CHANGED" | grep -qE '^(frontend/|deploy/frontend/)'; then SERVICES="$SERVICES frontend"; fi

# Trim whitespace
SERVICES_TRIMMED="$(printf "%s" "$SERVICES" | tr -d ' ' || true)"

if [[ "$MODE" == "all" ]]; then
  echo "[deploy] Rebuilding ALL services"
  docker compose up -d --build
elif [[ "$MODE" == "pull" ]]; then
  echo "[deploy] Pulling prebuilt images (GHCR)"
  docker compose -f docker-compose.yml -f docker-compose.ghcr.yml pull
  docker compose -f docker-compose.yml -f docker-compose.ghcr.yml up -d
elif [[ "$MODE" == "no-build" ]]; then
  echo "[deploy] No build; restarting containers"
  docker compose up -d
elif [[ -n "$SERVICES_TRIMMED" ]]; then
  echo "[deploy] Rebuilding services:$SERVICES"
  if printf "%s\n" "$SERVICES" | grep -q "frontend"; then
    echo "[deploy] NOTE: frontend rebuilds can take several minutes on small droplets (Vite + npm ci)."
  fi
  docker compose up -d --build $SERVICES
else
  echo "[deploy] No build needed; restarting containers"
  docker compose up -d
fi

docker compose ps

echo "[deploy] done: $NEW_SHA"