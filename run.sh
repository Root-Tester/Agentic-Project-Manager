#!/usr/bin/env bash
# run.sh — container entrypoint for Agentic Project Manager on Render.
#
# Modes (set APM_RUN_MODE as a Render environment variable):
#   single (default)  Build the frontend once, then run ONLY the Node API,
#                     which serves frontend/dist on Render's public $PORT.
#   split             Run the API on $API_PORT (internal) and the frontend
#                     server on Render's public $PORT, proxying /api to the API.
#
# Required env vars (set in Render dashboard -> Environment):
#   APM_JWT_SECRET               generate with: npm run generate:jwt-secret
#   APM_PLATFORM_ADMIN_EMAILS    comma-separated trusted admin emails
# Optional:
#   APM_DATABASE_PATH            default /data/agentic-project-manager.sqlite
#   APM_PUBLIC_COMPANY_SIGNUP    true/false (needs SMTP settings if true)

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

log() { printf '[run.sh] %s\n' "$*"; }

# ---------- Configuration ----------
export NODE_ENV="${NODE_ENV:-production}"
PUBLIC_PORT="${PORT:-7860}"          # Render injects PORT (default 10000)
API_PORT="${API_PORT:-4000}"
RUN_MODE="${APM_RUN_MODE:-single}"

# SQLite location. On Render this only survives restarts if a persistent
# disk is mounted at /data (paid instances). Otherwise data is ephemeral.
export APM_DATABASE_PATH="${APM_DATABASE_PATH:-/data/agentic-project-manager.sqlite}"
mkdir -p "$(dirname "$APM_DATABASE_PATH")"

# ---------- Validate required secrets ----------
: "${APM_JWT_SECRET:?APM_JWT_SECRET is not set. Add it in Render -> Environment.}"
: "${APM_PLATFORM_ADMIN_EMAILS:?APM_PLATFORM_ADMIN_EMAILS is not set. Add it in Render -> Environment.}"

# ---------- Install + build (skipped if already done in the image) ----------
if [ ! -d node_modules ]; then
  log "Installing dependencies (npm ci)..."
  npm ci
fi

if [ ! -f frontend/dist/index.html ]; then
  log "Building frontend (npm run build:web)..."
  npm run build:web
fi

# Pick the production start command if the project defines one, else fall back to dev.
if node -e "process.exit(require('./package.json').scripts?.start ? 0 : 1)" 2>/dev/null; then
  API_CMD=(npm run start)
else
  API_CMD=(npm run dev)
fi

# ---------- Run ----------
case "$RUN_MODE" in
  single)
    log "Mode: single — API (+ built frontend) on port ${PUBLIC_PORT}"
    export PORT="$PUBLIC_PORT"
    exec "${API_CMD[@]}"
    ;;

  split)
    log "Mode: split — API on ${API_PORT}, frontend on ${PUBLIC_PORT}"

    PIDS=()
    cleanup() {
      log "Shutting down..."
      for pid in "${PIDS[@]:-}"; do kill "$pid" 2>/dev/null || true; done
      wait 2>/dev/null || true
    }
    trap cleanup INT TERM EXIT

    PORT="$API_PORT" "${API_CMD[@]}" &
    PIDS+=($!)

    # Wait for the API health endpoint before exposing the frontend.
    for i in $(seq 1 30); do
      if curl -fsS "http://127.0.0.1:${API_PORT}/healthz" >/dev/null 2>&1; then
        log "API is healthy."
        break
      fi
      sleep 1
      [ "$i" -eq 30 ] && { log "API failed to become healthy."; exit 1; }
    done

    npm run start:web -- --host 0.0.0.0 --port "$PUBLIC_PORT" &
    PIDS+=($!)

    # Exit (and let Render restart us) as soon as either process dies.
    wait -n
    exit $?
    ;;

  *)
    log "Unknown APM_RUN_MODE='${RUN_MODE}' (use 'single' or 'split')"
    exit 1
    ;;
esac
